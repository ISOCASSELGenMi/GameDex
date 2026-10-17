/**
 * Phase 7 第 5～7 波細則（D83）整合測試（真實 PG；handler 直接呼叫）：
 * 停權者（可登入；新增／修改一律 403 account_suspended；讀取、匯出、刪除、私人 iCal 下載照舊；對他人隱藏）、
 * 帳號狀態端點、遊玩紀錄列表的平台名稱（批次）、孤兒清理保險告警、匯出的 role／handle／emailVerified。
 * 玩家平均（created_at、耗時門檻）在 lists-play-5.test.ts；追蹤熱度、iCal 活動／類型在 follows-6.test.ts。
 * 信箱一律 u7- 開頭；遊戲 slug 前綴 u7-；igdbId 988xxx。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { resetCoreEnvCache } from "@/kernel/config/env";
import { games, gamePlatforms, platforms } from "@/modules/catalog/schema";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { follows, users } from "@/modules/accounts/schema";
import { AUTH_BASE_PATH } from "@/modules/accounts/providers/auth";
import { handleAuthRequest, resetAuthForTests } from "@/modules/accounts/use-cases";
import { handleList, handleLists, handlePlayRecords, handleSharedList } from "@/modules/accounts/use-cases/account-data-request";
import { handleFollowTarget } from "@/modules/accounts/use-cases/follow-request";
import { handleFeed, handleFeedRotate, handleFeeds, handlePrivateIcs } from "@/modules/accounts/use-cases/feed-request";
import { handleImportRequest, handleManualMatchRequest } from "@/modules/accounts/use-cases/import-request";
import { handleAccount, handleAccountDelete, handleAccountExport, handleAccountPreferences } from "@/modules/accounts/use-cases/account-self-request";
import { adminSetSuspended } from "@/modules/accounts/use-cases/account-self";
import { cleanupOrphanFollows, orphanSanityAlertMessage, ORPHAN_SANITY_MIN_TARGETS } from "@/modules/accounts/use-cases/follows";
import { resetRateLimitsForTests } from "@/modules/accounts/use-cases/rate-limit";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "a long password 1";
const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES", "PLAYER_RATING_MIN_COUNT"] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  delete process.env.MODULES;
  resetAuthForTests();
  resetCoreEnvCache();
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => !/=$/.test(c))
    .join("; ");

interface Account {
  id: number;
  email: string;
  cookie: string;
}

async function signUp(email: string, name = "U7 Tester"): Promise<Account> {
  const res = await handleAuthRequest(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-up/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
  expect(res.status).toBe(200);
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  return { id: u!.id, email, cookie: cookieOf(res) };
}

async function signIn(email: string): Promise<Response> {
  return handleAuthRequest(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

interface CallOpts {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
}
function request(method: string, path: string, o: CallOpts = {}): Request {
  const headers: Record<string, string> = {};
  if (o.origin !== null && method !== "GET" && method !== "HEAD") headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const json = (res: Response): Promise<J> => res.json();
const SUSPENDED = { code: "account_suspended" };

describe.skipIf(!enabled)("accounts 第 5～7 波細則（D83）", () => {
  let platformA = 0;
  let platformB = 0;
  const platformIds: number[] = [];
  const gameIds: number[] = [];
  const gid: Record<string, number> = {};

  async function addGame(key: string, platformId: number): Promise<number> {
    const name = `U7 ${key}`;
    const [g] = await getDb()
      .insert(games)
      .values({ igdbId: 988000 + gameIds.length + 1, slug: `u7-${key}`, name, searchText: buildSearchText([name]), firstReleaseDate: "2027-01-01", firstReleasePrecision: "day" })
      .returning({ id: games.id });
    await getDb().insert(gamePlatforms).values({ gameId: g!.id, platformId });
    gid[key] = g!.id;
    gameIds.push(g!.id);
    return g!.id;
  }

  const deps = { defer: () => {} };
  const createList = async (acc: Account, body: unknown): Promise<J> => {
    const res = await handleLists(request("POST", "/api/v1/lists", { cookie: acc.cookie, body }));
    expect(res.status).toBe(201);
    return (await json(res)).list;
  };
  const createPlay = async (acc: Account, body: unknown): Promise<J> => {
    const res = await handlePlayRecords(request("POST", "/api/v1/play-records", { cookie: acc.cookie, body }));
    expect(res.status).toBe(201);
    return (await json(res)).record;
  };
  const feedOf = async (acc: Account): Promise<J> => (await json(await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: acc.cookie })))).feed;
  const tokenOf = (url: string) => /\/ical\/u\/([A-Za-z0-9_-]{43})\.ics$/.exec(url)![1]!;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv();
    platformA = (await upsertPlatform({ igdbId: 988901, slug: "u7-pa", name: "U7 Platform Alpha", abbreviation: "U7A", kind: "console" })).id;
    platformB = (await upsertPlatform({ igdbId: 988902, slug: "u7-pb", name: "U7 Platform Beta", abbreviation: null, kind: "pc" })).id;
    platformIds.push(platformA, platformB);
    await addGame("a", platformA);
    await getDb().insert(gamePlatforms).values({ gameId: gid.a!, platformId: platformB });
    await addGame("b", platformA);
  });

  beforeEach(() => {
    resetRateLimitsForTests();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(users).where(like(users.email, "u7-%"));
    if (gameIds.length) await db.delete(games).where(inArray(games.id, gameIds));
    if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    resetCoreEnvCache();
    await closeDb();
  });

  // ── 3. 停權者 ────────────────────────────────────────────────────────────
  describe("停權者（D83）", () => {
    it("GET /api/v1/account 回報停權狀態；未登入 401", async () => {
      const A = await signUp("u7-status@example.com");
      expect((await handleAccount(request("GET", "/api/v1/account"))).status).toBe(401);
      const ok = await handleAccount(request("GET", "/api/v1/account", { cookie: A.cookie }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      expect(await json(ok)).toEqual({ suspended: false });
      await adminSetSuspended(A.id, true);
      const cookie = cookieOf(await signIn(A.email));
      expect(await json(await handleAccount(request("GET", "/api/v1/account", { cookie })))).toEqual({ suspended: true });
      expect((await handleAccount(request("POST", "/api/v1/account", { cookie }))).status).toBe(405);
    });

    it("可登入；清單、遊玩紀錄、追蹤、偏好、私人 iCal 設定與 rotate、Steam 匯入與手動比對都 403 account_suspended（集中在 authenticate）", async () => {
      const S = await signUp("u7-susp-writes@example.com");
      const list = await createList(S, { name: "Before" });
      const feed = await feedOf(S);
      await adminSetSuspended(S.id, true);
      const login = await signIn(S.email);
      expect(login.status).toBe(200); // 停權者可登入
      const cookie = cookieOf(login);

      const blocked = async (res: Response, label: string) => {
        expect(res.status, label).toBe(403);
        expect(await json(res), label).toEqual(SUSPENDED);
        expect(res.headers.get("cache-control"), label).toBe("no-store");
      };
      await blocked(await handleLists(request("POST", "/api/v1/lists", { cookie, body: { name: "After" } })), "新增清單");
      await blocked(await handlePlayRecords(request("POST", "/api/v1/play-records", { cookie, body: { gameId: gid.a, status: "playing" } })), "新增遊玩紀錄");
      await blocked(await handleFollowTarget(request("PUT", `/api/v1/follows/game/${gid.a}`, { cookie }), "game", String(gid.a)), "追蹤");
      await blocked(await handleFollowTarget(request("DELETE", `/api/v1/follows/game/${gid.a}`, { cookie }), "game", String(gid.a)), "取消追蹤");
      await blocked(await handleAccountPreferences(request("PATCH", "/api/v1/account/preferences", { cookie, body: { timezone: "UTC" } })), "偏好");
      await blocked(await handleFeed(request("PATCH", `/api/v1/calendar/feeds/${feed.id}`, { cookie, body: { name: "x" } }), String(feed.id)), "私人 iCal 設定");
      await blocked(await handleFeedRotate(request("POST", `/api/v1/calendar/feeds/${feed.id}/rotate`, { cookie }), String(feed.id)), "rotate");
      await blocked(await handleFeeds(request("POST", "/api/v1/calendar/feeds", { cookie })), "建立 feed（POST）");
      await blocked(await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie })), "取得 feed（GET 可能建立）");
      await blocked(await handleImportRequest(request("POST", "/api/v1/imports/steam", { cookie }), "steam", deps), "Steam 匯入");
      await blocked(await handleManualMatchRequest(request("PATCH", "/api/v1/imports/steam/games/1", { cookie, body: { reset: true } }), "steam", "1", deps), "手動指定比對");

      // 順序：Origin（403 invalid_origin）與未登入（401）先於停權判斷
      const evil = await handleLists(request("POST", "/api/v1/lists", { cookie, body: { name: "x" }, origin: "https://evil.example" }));
      expect(await json(evil)).toEqual({ code: "invalid_origin" });
      expect((await handleLists(request("POST", "/api/v1/lists", { body: { name: "x" } }))).status).toBe(401);

      // 沒有任何東西被寫入
      const lists = await json(await handleLists(request("GET", "/api/v1/lists", { cookie })));
      expect(lists.items.map((l: J) => l.name)).toEqual(["Before"]);
      expect(list.name).toBe("Before");
      const rows = await getDb().select().from(follows).where(eq(follows.userId, S.id));
      expect(rows).toHaveLength(0);

      // 解除停權後立刻恢復
      await adminSetSuspended(S.id, false);
      expect((await handleLists(request("POST", "/api/v1/lists", { cookie, body: { name: "After" } }))).status).toBe(201);
    });

    it("停權者可以讀自己的資料、匯出、讀私人 iCal（維持可下載）、刪除帳號", async () => {
      const S = await signUp("u7-susp-reads@example.com");
      await createList(S, { name: "Mine" });
      const token = tokenOf((await feedOf(S)).url);
      await adminSetSuspended(S.id, true);
      const cookie = cookieOf(await signIn(S.email));

      expect((await handleLists(request("GET", "/api/v1/lists", { cookie }))).status).toBe(200);
      expect((await handleAccountPreferences(request("GET", "/api/v1/account/preferences", { cookie }))).status).toBe(200);
      const exp = await handleAccountExport(request("GET", "/api/v1/account/export", { cookie }));
      expect(exp.status).toBe(200);
      expect((await json(exp)).lists.map((l: J) => l.name)).toEqual(["Mine"]);
      // 私人 iCal：本人資料、唯讀，日曆 App 不帶 Cookie 也不該突然變成空白 → 維持可下載（待決列在報告）
      const ics = await handlePrivateIcs(request("GET", `/ical/u/${token}.ics`), `${token}.ics`);
      expect(ics.status).toBe(200);
      expect(ics.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      // 刪除帳號是唯一允許的寫入
      const del = await handleAccountDelete(request("DELETE", "/api/v1/account", { cookie, body: { password: PASSWORD } }));
      expect(del.status).toBe(200);
      expect(await getDb().select().from(users).where(eq(users.id, S.id))).toHaveLength(0);
    });

    it("public 與 unlisted 清單對他人都隱藏、解除後恢復；本人仍看得到", async () => {
      const S = await signUp("u7-susp-hidden@example.com");
      const pub = await createList(S, { name: "Pub", visibility: "public" });
      const unl = await createList(S, { name: "Unl", visibility: "unlisted" });
      const readPub = async (cookie?: string) => (await handleList(request("GET", `/api/v1/lists/${pub.id}`, { cookie }), String(pub.id))).status;
      const readUnl = async (cookie?: string) => (await handleSharedList(request("GET", `/api/v1/lists/shared/${unl.shareToken}`, { cookie }), unl.shareToken)).status;
      expect([await readPub(), await readUnl()]).toEqual([200, 200]);
      await adminSetSuspended(S.id, true);
      expect([await readPub(), await readUnl()]).toEqual([404, 404]);
      const own = cookieOf(await signIn(S.email));
      expect(await readPub(own)).toBe(200); // 本人仍可讀
      await adminSetSuspended(S.id, false);
      expect([await readPub(), await readUnl()]).toEqual([200, 200]);
    });
  });

  // ── 5. 遊玩紀錄列表的平台名稱 ───────────────────────────────────────────
  describe("遊玩紀錄列表附平台（D83）", () => {
    it("每筆 platform:{id,name,abbreviation}|null，一次批次取得", async () => {
      const A = await signUp("u7-plat@example.com");
      await createPlay(A, { gameId: gid.a, status: "finished", platformId: platformA });
      await createPlay(A, { gameId: gid.a, status: "playing", platformId: platformB });
      await createPlay(A, { gameId: gid.b, status: "paused" });
      const res = await handlePlayRecords(request("GET", "/api/v1/play-records?locale=en", { cookie: A.cookie }));
      expect(res.status).toBe(200);
      const items: J[] = (await json(res)).items;
      expect(items).toHaveLength(3);
      const by = (status: string) => items.find((i) => i.status === status);
      expect(by("finished").platform).toEqual({ id: platformA, name: "U7 Platform Alpha", abbreviation: "U7A" });
      expect(by("playing").platform).toEqual({ id: platformB, name: "U7 Platform Beta", abbreviation: null });
      expect(by("paused").platform).toBeNull();
      expect(by("paused").platformId).toBeNull();
    });
  });

  // ── 13. 孤兒清理保險告警 ────────────────────────────────────────────────
  describe("孤兒清理保險告警（D83）", () => {
    it("某種類 ≥ 20 個目標全不存在 → 不刪、發告警一次；訊息只有種類與數量，不含個資", async () => {
      const A = await signUp("u7-orphan@example.com", "Secret Display Name");
      const db = getDb();
      const many = Array.from({ length: ORPHAN_SANITY_MIN_TARGETS }, (_, i) => ({ userId: A.id, targetType: "platform" as const, targetId: 989_100_000 + i }));
      await db.insert(follows).values(many);
      const messages: string[] = [];
      const logs: string[] = [];
      const res = await cleanupOrphanFollows({ webhookUrl: "https://hook.example/u7", alert: async (m) => void messages.push(m), log: (m) => void logs.push(m) });
      expect(res.platform).toBe(0);
      expect((await db.select().from(follows).where(eq(follows.userId, A.id))).length).toBe(ORPHAN_SANITY_MIN_TARGETS); // 沒刪
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe(orphanSanityAlertMessage([{ type: "platform", targets: ORPHAN_SANITY_MIN_TARGETS }]));
      expect(messages[0]).toContain("platform");
      expect(messages[0]).toContain(String(ORPHAN_SANITY_MIN_TARGETS));
      for (const forbidden of [A.email, "Secret Display Name", String(A.id), "989100000"]) expect(messages[0]).not.toContain(forbidden);
      expect(logs.join("\n")).toContain("platform");

      // 沒有設定告警網址：只寫 log，不丟例外
      const quiet: string[] = [];
      await cleanupOrphanFollows({ webhookUrl: undefined, log: (m) => void quiet.push(m) });
      expect(quiet).toHaveLength(1);

      // 告警通道丟例外：吞掉，清理照常結束
      const failing: string[] = [];
      await expect(
        cleanupOrphanFollows({ webhookUrl: "https://hook.example/u7", alert: async () => { throw new Error("boom"); }, log: (m) => void failing.push(m) }),
      ).resolves.toBeDefined();
      expect(failing.some((m) => m.includes("boom"))).toBe(true);

      // 正常清理（有存在的目標，或不到 20 個）不發告警
      await db.delete(follows).where(eq(follows.userId, A.id));
      await db.insert(follows).values({ userId: A.id, targetType: "platform", targetId: 989_100_001 });
      const none: string[] = [];
      const ok = await cleanupOrphanFollows({ webhookUrl: "https://hook.example/u7", alert: async (m) => void none.push(m), log: () => {} });
      expect(ok.platform).toBe(1); // 不到 20 個：照刪
      expect(none).toEqual([]);
    });
  });

  // ── 14. 匯出欄位 ────────────────────────────────────────────────────────
  describe("匯出含 role、handle、emailVerified（D83）", () => {
    it("JSON 與 CSV 的個人資料段都有", async () => {
      const A = await signUp("u7-export@example.com");
      await getDb().update(users).set({ handle: "u7handle", role: "admin", emailVerified: true }).where(eq(users.id, A.id));
      const j = await json(await handleAccountExport(request("GET", "/api/v1/account/export?format=json", { cookie: A.cookie })));
      expect(j.profile).toMatchObject({ role: "admin", handle: "u7handle", emailVerified: true });
      const csv = await (await handleAccountExport(request("GET", "/api/v1/account/export?format=csv&part=profile", { cookie: A.cookie }))).text();
      const [header, row] = csv.replace(/^﻿/, "").split("\r\n");
      const cols = header!.split(",");
      const cells = row!.split(",");
      const cell = (name: string) => cells[cols.indexOf(name)];
      expect(cols).toEqual(expect.arrayContaining(["role", "handle", "email_verified"]));
      expect(cell("role")).toBe("admin");
      expect(cell("handle")).toBe("u7handle");
      expect(cell("email_verified")).toBe("true");
    });
  });
});
