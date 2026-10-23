/**
 * GameDex 第 2 輪 Z3B 整合測試（真實 PG；handler 直接呼叫）：/api/v1/me/unlocks 的 GET／POST（401、停權 403、Origin 403、合併規則、冪等、上限、
 * 未知 key 丟棄）、帳號資料判定的成就、all-achievements 的前置條件、資料匯出含 unlocks、刪除帳號後紀錄消失。
 * 信箱一律 z3b- 開頭；遊戲 slug 前綴 z3b-；igdbId 988xxx。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { resetCoreEnvCache } from "@/kernel/config/env";
import { games, gamePlatforms, platforms } from "@/modules/catalog/schema";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { userUnlocks, users } from "@/modules/accounts/schema";
import { AUTH_BASE_PATH } from "@/modules/accounts/providers/auth";
import { handleAuthRequest, resetAuthForTests } from "@/modules/accounts/use-cases";
import { handleLists } from "@/modules/accounts/use-cases/account-data-request";
import { handleFollowTarget } from "@/modules/accounts/use-cases/follow-request";
import { handleFeeds } from "@/modules/accounts/use-cases/feed-request";
import { handleAccountDelete, handleAccountExport } from "@/modules/accounts/use-cases/account-self-request";
import { handleUnlocks } from "@/modules/accounts/use-cases/unlocks-request";
import { resetRateLimitsForTests } from "@/modules/accounts/use-cases/rate-limit";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "a long password 1";
const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES"] as const;
const saved: Record<string, string | undefined> = {};

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => !/=$/.test(c))
    .join("; ");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const json = (res: Response): Promise<J> => res.json();

interface Account {
  id: number;
  email: string;
  cookie: string;
}

async function signUp(email: string): Promise<Account> {
  const res = await handleAuthRequest(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-up/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name: "Z3B Tester" }),
    }),
  );
  expect(res.status).toBe(200);
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  return { id: u!.id, email, cookie: cookieOf(res) };
}

function req(method: string, path: string, o: { cookie?: string | null; body?: unknown; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = {};
  if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}

const getUnlocks = (a: Account | null) => handleUnlocks(req("GET", "/api/v1/me/unlocks", { cookie: a?.cookie }));
const postUnlocks = (a: Account | null, body: unknown, o: { origin?: string | null } = {}) =>
  handleUnlocks(req("POST", "/api/v1/me/unlocks", { cookie: a?.cookie, body, ...o }));
const keysOf = (list: J[]) => list.map((r: J) => `${r.type}:${r.key}`);

describe.skipIf(!enabled)("Z3B：解鎖紀錄 API", () => {
  let platformId = 0;
  const gameIds: number[] = [];

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.AUTH_SECRET = SECRET;
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    process.env.ACCOUNTS_SIGNUP_ENABLED = "true";
    process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
    delete process.env.MODULES;
    resetAuthForTests();
    resetCoreEnvCache();
    platformId = (await upsertPlatform({ igdbId: 988901, slug: "z3b-p1", name: "Z3B P1", abbreviation: "Z3B", kind: "console" })).id;
    const name = "Z3B Game";
    const [g] = await getDb()
      .insert(games)
      .values({ igdbId: 988001, slug: "z3b-game", name, searchText: buildSearchText([name]), firstReleaseDate: "2027-01-01", firstReleasePrecision: "day" })
      .returning({ id: games.id });
    await getDb().insert(gamePlatforms).values({ gameId: g!.id, platformId });
    gameIds.push(g!.id);
  });

  beforeEach(() => resetRateLimitsForTests());

  afterAll(async () => {
    const db = getDb();
    await db.delete(users).where(like(users.email, "z3b-%"));
    if (gameIds.length) await db.delete(games).where(inArray(games.id, gameIds));
    await db.delete(platforms).where(eq(platforms.id, platformId));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    resetCoreEnvCache();
    await closeDb();
  });

  it("未登入 GET／POST 401；Origin 不符 POST 403；其他方法 405；回應 no-store", async () => {
    expect((await getUnlocks(null)).status).toBe(401);
    expect((await postUnlocks(null, { unlocks: [] })).status).toBe(401);
    const A = await signUp("z3b-auth@example.com");
    const bad = await postUnlocks(A, { unlocks: [] }, { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(await json(bad)).toEqual({ code: "invalid_origin" });
    const put = await handleUnlocks(req("PUT", "/api/v1/me/unlocks", { cookie: A.cookie }));
    expect(put.status).toBe(405);
    const ok = await getUnlocks(A);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await json(ok)).toEqual({ unlocks: [] });
  });

  it("POST：驗證 body、上限 100 筆、未知 type／key／時間格式錯誤的項目丟棄", async () => {
    const A = await signUp("z3b-validate@example.com");
    expect((await postUnlocks(A, {})).status).toBe(400);
    expect((await postUnlocks(A, { unlocks: "x" })).status).toBe(400);
    expect((await postUnlocks(A, [])).status).toBe(400);
    const many = Array.from({ length: 101 }, () => ({ type: "theme", key: "gold", at: "2026-01-01T00:00:00Z" }));
    const tooMany = await postUnlocks(A, { unlocks: many });
    expect(tooMany.status).toBe(400);
    expect(await json(tooMany)).toEqual({ code: "validation_failed", fields: { unlocks: "too_many" } });
    const exactly = await postUnlocks(A, { unlocks: many.slice(0, 100) });
    expect(exactly.status).toBe(200);

    const B = await signUp("z3b-drop@example.com");
    const res = await postUnlocks(B, {
      unlocks: [
        { type: "theme", key: "sony-blue", at: "2026-02-01T00:00:00Z" },
        { type: "theme", key: "no-such-theme", at: "2026-02-01T00:00:00Z" },
        { type: "weird", key: "gold", at: "2026-02-01T00:00:00Z" },
        { type: "collectible", key: "cd", at: "not-a-date" },
        { type: "collectible", key: "cloud" },
        "garbage",
        null,
      ],
    });
    expect(res.status).toBe(200);
    expect(keysOf((await json(res)).unlocks)).toEqual(["theme:sony-blue"]);
  });

  it("POST：同 key 取較早時間、冪等、跨請求累積為聯集", async () => {
    const A = await signUp("z3b-merge@example.com");
    const first = await json(await postUnlocks(A, { unlocks: [{ type: "theme", key: "gold", at: "2026-03-02T00:00:00Z" }, { type: "collectible", key: "cd", at: "2026-03-01T00:00:00Z" }] }));
    expect(first.unlocks).toEqual([
      { type: "collectible", key: "cd", at: "2026-03-01T00:00:00.000Z" },
      { type: "theme", key: "gold", at: "2026-03-02T00:00:00.000Z" },
    ]);
    // 較晚的時間不覆蓋；較早的覆蓋；新 key 加入
    const second = await json(
      await postUnlocks(A, {
        unlocks: [
          { type: "theme", key: "gold", at: "2026-03-05T00:00:00Z" },
          { type: "collectible", key: "cd", at: "2026-02-01T00:00:00Z" },
          { type: "collectible", key: "dvd", at: "2026-03-03T00:00:00Z" },
        ],
      }),
    );
    expect(second.unlocks).toEqual([
      { type: "collectible", key: "cd", at: "2026-02-01T00:00:00.000Z" },
      { type: "collectible", key: "dvd", at: "2026-03-03T00:00:00.000Z" },
      { type: "theme", key: "gold", at: "2026-03-02T00:00:00.000Z" },
    ]);
    const again = await json(await postUnlocks(A, { unlocks: second.unlocks }));
    expect(again.unlocks).toEqual(second.unlocks);
    expect((await json(await getUnlocks(A))).unlocks).toEqual(second.unlocks);
    expect(await postUnlocks(A, { unlocks: [] }).then(json)).toEqual({ unlocks: second.unlocks });
  });

  it("POST：未來時間夾到現在", async () => {
    const A = await signUp("z3b-future@example.com");
    const before = Date.now();
    const res = await json(await postUnlocks(A, { unlocks: [{ type: "theme", key: "gold", at: "2999-01-01T00:00:00Z" }] }));
    const at = Date.parse(res.unlocks[0].at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("兩個帳號互不影響", async () => {
    const A = await signUp("z3b-iso-a@example.com");
    const B = await signUp("z3b-iso-b@example.com");
    await postUnlocks(A, { unlocks: [{ type: "theme", key: "gold", at: "2026-03-02T00:00:00Z" }] });
    expect((await json(await getUnlocks(B))).unlocks).toEqual([]);
  });

  it("停權者 GET／POST 一律 403 account_suspended", async () => {
    const S = await signUp("z3b-suspended@example.com");
    await postUnlocks(S, { unlocks: [{ type: "theme", key: "gold", at: "2026-03-02T00:00:00Z" }] });
    await getDb().update(users).set({ suspendedAt: new Date() }).where(eq(users.id, S.id));
    const post = await postUnlocks(S, { unlocks: [{ type: "theme", key: "coding", at: "2026-03-02T00:00:00Z" }] });
    expect(post.status).toBe(403);
    expect(await json(post)).toEqual({ code: "account_suspended" });
    expect((await getUnlocks(S)).status).toBe(403);
    const rows = await getDb().select().from(userUnlocks).where(eq(userUnlocks.userId, S.id));
    expect(rows.map((r) => r.key)).toEqual(["gold"]);
  });

  it("帳號資料成就：追蹤 → first-follow、建立清單 → first-list、取得私人行事曆 → first-ical-subscribe；取消後仍保留", async () => {
    const A = await signUp("z3b-derived@example.com");
    expect((await json(await getUnlocks(A))).unlocks).toEqual([]);

    expect((await handleFollowTarget(req("PUT", `/api/v1/follows/game/${gameIds[0]}`, { cookie: A.cookie }), "game", String(gameIds[0]))).status).toBe(201);
    expect(keysOf((await json(await getUnlocks(A))).unlocks)).toEqual(["achievement:first-follow"]);

    const list = await handleLists(req("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "Z3B list" } }));
    expect(list.status).toBe(201);
    expect((await handleFeeds(req("GET", "/api/v1/calendar/feeds", { cookie: A.cookie }))).status).toBe(200);
    const all = keysOf((await json(await getUnlocks(A))).unlocks);
    expect(all).toEqual(["achievement:first-follow", "achievement:first-ical-subscribe", "achievement:first-list"]);

    // 取消追蹤後成就仍在（已持久化）
    await handleFollowTarget(req("DELETE", `/api/v1/follows/game/${gameIds[0]}`, { cookie: A.cookie }), "game", String(gameIds[0]));
    const first = (await json(await getUnlocks(A))).unlocks as J[];
    expect(keysOf(first)).toContain("achievement:first-follow");
    // 冪等：再讀一次時間不變
    expect((await json(await getUnlocks(A))).unlocks).toEqual(first);
  });

  it("瀏覽器 push 的 first-follow 與帳號資料合併取較早時間", async () => {
    const A = await signUp("z3b-earlier@example.com");
    await handleFollowTarget(req("PUT", `/api/v1/follows/game/${gameIds[0]}`, { cookie: A.cookie }), "game", String(gameIds[0]));
    const res = await json(await postUnlocks(A, { unlocks: [{ type: "achievement", key: "first-follow", at: "2020-01-01T00:00:00Z" }] }));
    expect(res.unlocks).toEqual([{ type: "achievement", key: "first-follow", at: "2020-01-01T00:00:00.000Z" }]);
  });

  it("all-achievements：其他成就未齊時丟棄，齊了才接受", async () => {
    const A = await signUp("z3b-all@example.com");
    const all = { type: "achievement", key: "all-achievements", at: "2026-04-01T00:00:00Z" };
    const early = await json(await postUnlocks(A, { unlocks: [all, { type: "achievement", key: "viewed-50-games", at: "2026-04-01T00:00:00Z" }] }));
    expect(keysOf(early.unlocks)).toEqual(["achievement:viewed-50-games"]);

    await handleFollowTarget(req("PUT", `/api/v1/follows/game/${gameIds[0]}`, { cookie: A.cookie }), "game", String(gameIds[0]));
    await handleLists(req("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "Z3B all" } }));
    await handleFeeds(req("GET", "/api/v1/calendar/feeds", { cookie: A.cookie }));
    const done = await json(await postUnlocks(A, { unlocks: [all] }));
    expect(keysOf(done.unlocks)).toEqual([
      "achievement:all-achievements",
      "achievement:first-follow",
      "achievement:first-ical-subscribe",
      "achievement:first-list",
      "achievement:viewed-50-games",
    ]);
  });

  it("匯出 JSON 含 unlocks；刪除帳號後紀錄消失（FK cascade）", async () => {
    const A = await signUp("z3b-export@example.com");
    await postUnlocks(A, { unlocks: [{ type: "theme", key: "night-owl", at: "2026-05-01T00:00:00Z" }, { type: "collectible", key: "cloud", at: "2026-05-02T00:00:00Z" }] });
    const exp = await handleAccountExport(req("GET", "/api/v1/account/export", { cookie: A.cookie }));
    expect(exp.status).toBe(200);
    const data = await json(exp);
    expect(data.unlocks).toEqual([
      { type: "collectible", key: "cloud", at: "2026-05-02T00:00:00.000Z" },
      { type: "theme", key: "night-owl", at: "2026-05-01T00:00:00.000Z" },
    ]);
    expect((await getDb().select().from(userUnlocks).where(eq(userUnlocks.userId, A.id))).length).toBe(2);

    const del = await handleAccountDelete(req("DELETE", "/api/v1/account", { cookie: A.cookie, body: { password: PASSWORD } }));
    expect(del.status).toBe(200);
    expect((await getDb().select().from(userUnlocks).where(eq(userUnlocks.userId, A.id))).length).toBe(0);
  });
});
