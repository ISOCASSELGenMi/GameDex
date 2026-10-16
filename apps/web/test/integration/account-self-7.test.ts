/**
 * Phase 7 第 7 波整合測試（真實 PG；handler 直接呼叫，不經 HTTP）：
 * 偏好（驗證、PATCH、清除、預設可見度生效）、刪除帳號（密碼、重新驗證、限流、所有關聯表清空、私人 feed 404、session 失效與 cookie 清除、稽核 log 無個資）、
 * 資料匯出（JSON 內容與機密排除、CSV 分段與公式注入、限流）、停權（session 撤銷、熱度與玩家平均不計、清單隱藏、仍可登入／匯出／刪除）、
 * /internal/users 的 POST（Basic auth、同源、CSRF）。
 * 信箱一律 t7- 開頭；遊戲 slug 前綴 t7-；igdbId 987xxx。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { resetCoreEnvCache } from "@/kernel/config/env";
import { games, gamePlatforms, platforms } from "@/modules/catalog/schema";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { authTokens, calendarFeeds, connectedAccounts, follows, gamePlayerRatings, ownedGames, playRecords, sessions, userListGames, userLists, users } from "@/modules/accounts/schema";
import { AUTH_BASE_PATH } from "@/modules/accounts/providers/auth";
import { handleAuthRequest, resetAuthForTests } from "@/modules/accounts/use-cases";
import { handleLists, handlePlayRecords, handleSharedList, handleList, handleListGame } from "@/modules/accounts/use-cases/account-data-request";
import { handleFollowTarget } from "@/modules/accounts/use-cases/follow-request";
import { handleFeeds, handlePrivateIcs } from "@/modules/accounts/use-cases/feed-request";
import { handleAccountDelete, handleAccountExport, handleAccountPreferences } from "@/modules/accounts/use-cases/account-self-request";
import { adminSetSuspended, setAuditLogForTests } from "@/modules/accounts/use-cases/account-self";
import { handleAdminUserAction } from "@/modules/accounts/use-cases/admin-users-request";
import { resetRateLimitsForTests } from "@/modules/accounts/use-cases/rate-limit";
import { runRefreshPlayerRatings } from "@/modules/accounts/use-cases/play-records";
import { siteFollowsSignal } from "@/modules/accounts/use-cases/catalog-extensions";
import { ACCOUNT_DELETE_RATE_LIMIT, ACCOUNT_EXPORT_RATE_LIMIT } from "@/modules/accounts/domain/entities/account-self";
import { createCsrfToken, isSameOrigin, verifyCsrfToken } from "@/modules/admin/csrf";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "a long password 1";
const ADMIN_USER = "t7admin";
const ADMIN_PASS = "t7-admin-pass";
const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES", "ADMIN_BASIC_AUTH_USER", "ADMIN_BASIC_AUTH_PASS", "PLAYER_RATING_MIN_COUNT"] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  process.env.ADMIN_BASIC_AUTH_USER = ADMIN_USER;
  process.env.ADMIN_BASIC_AUTH_PASS = ADMIN_PASS;
  process.env.PLAYER_RATING_MIN_COUNT = "1";
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

/** 只留 session token，不帶 cookie cache（讓 getSession 一定查資料庫，才能測 session 的新鮮度與撤銷）。 */
const tokenOnly = (cookie: string) =>
  cookie
    .split("; ")
    .filter((c) => !c.includes("session_data"))
    .join("; ");

interface Account {
  id: number;
  email: string;
  cookie: string;
}

async function signUp(email: string, name = "T7 Tester"): Promise<Account> {
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
  headers?: Record<string, string>;
}
function request(method: string, path: string, o: CallOpts = {}): Request {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.origin !== null && method !== "GET" && method !== "HEAD") headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const json = (res: Response): Promise<J> => res.json();

/** 最小的 CSV 解析（RFC 4180：雙引號欄位、"" 跳脫、CRLF）。回傳列的陣列。 */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && src[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe.skipIf(!enabled)("accounts 第 7 波：偏好、刪除帳號、匯出、停權", () => {
  let platformId = 0;
  const gameIds: number[] = [];
  const platformIds: number[] = [];
  const gid: Record<string, number> = {};
  const audits: Array<{ event: string; data: unknown }> = [];

  async function addGame(key: string): Promise<number> {
    const name = `T7 ${key}`;
    const [g] = await getDb()
      .insert(games)
      .values({ igdbId: 987000 + gameIds.length + 1, slug: `t7-${key}`, name, searchText: buildSearchText([name]), firstReleaseDate: "2027-01-01", firstReleasePrecision: "day" })
      .returning({ id: games.id });
    await getDb().insert(gamePlatforms).values({ gameId: g!.id, platformId });
    gid[key] = g!.id;
    gameIds.push(g!.id);
    return g!.id;
  }

  const del = (acc: Account | { cookie: string }, body?: unknown, o: CallOpts = {}) => handleAccountDelete(request("DELETE", "/api/v1/account", { cookie: acc.cookie, body, ...o }));
  const exportReq = (acc: Account, query = "") => handleAccountExport(request("GET", `/api/v1/account/export${query}`, { cookie: acc.cookie }));
  const getPrefs = (acc: Account | { cookie: string }) => handleAccountPreferences(request("GET", "/api/v1/account/preferences", { cookie: acc.cookie }));
  const patchPrefs = (acc: Account | { cookie: string }, body: unknown, o: CallOpts = {}) => handleAccountPreferences(request("PATCH", "/api/v1/account/preferences", { cookie: acc.cookie, body, ...o }));

  async function createListApi(acc: Account, body: unknown): Promise<J> {
    const res = await handleLists(request("POST", "/api/v1/lists", { cookie: acc.cookie, body }));
    expect(res.status).toBe(201);
    return (await json(res)).list;
  }
  async function addToListApi(acc: Account, listId: number, gameId: number, note?: string): Promise<void> {
    const res = await handleListGame(request("POST", `/api/v1/lists/${listId}/games/${gameId}`, { cookie: acc.cookie, body: note === undefined ? undefined : { note } }), String(listId), String(gameId));
    expect([200, 201]).toContain(res.status);
  }
  async function createPlayApi(acc: Account, body: unknown): Promise<J> {
    const res = await handlePlayRecords(request("POST", "/api/v1/play-records", { cookie: acc.cookie, body }));
    expect(res.status).toBe(201);
    return (await json(res)).record;
  }
  const followApi = (acc: Account, type: string, id: number) => handleFollowTarget(request("PUT", `/api/v1/follows/${type}/${id}`, { cookie: acc.cookie }), type, String(id));

  /** 在每個帳號表都放資料的使用者（刪除帳號與匯出共用）。回傳 feed token。 */
  async function seedEverything(acc: Account): Promise<{ feedToken: string; listId: number; connectedAccountId: number }> {
    const list = await createListApi(acc, { name: "Everything", description: "d", visibility: "unlisted" });
    await addToListApi(acc, list.id, gid.a!, "list note");
    await createPlayApi(acc, { gameId: gid.a, status: "finished", finishedOn: "2026-09-01", playMinutes: 90, ratingHalfSteps: 15, review: "great", privateNote: "my secret note" });
    expect((await followApi(acc, "game", gid.b!)).status).toBe(201);
    const [ca] = await getDb().insert(connectedAccounts).values({ userId: acc.id, provider: "steam", providerAccountId: `7656119800${acc.id}`, accessToken: "SECRET-ACCESS-TOKEN" }).returning({ id: connectedAccounts.id });
    await getDb().insert(ownedGames).values([
      { connectedAccountId: ca!.id, externalGameId: "1", externalTitle: "Matched", matchedGameId: gid.a!, matchConfidencePct: 100 },
      { connectedAccountId: ca!.id, externalGameId: "2", externalTitle: "Unmatched", matchedGameId: null, matchConfidencePct: 0 },
    ]);
    await getDb().insert(authTokens).values({ tokenHash: `t7${acc.id}`.padEnd(64, "0"), userId: acc.id, purpose: "confirm_notifications", expiresAt: new Date(Date.now() + 3600_000) });
    const feedRes = await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: acc.cookie }));
    const feed = (await json(feedRes)).feed;
    const feedToken = /\/ical\/u\/([A-Za-z0-9_-]{43})\.ics/.exec(feed.url)![1]!;
    return { feedToken, listId: list.id, connectedAccountId: ca!.id };
  }

  async function rowCounts(userId: number): Promise<Record<string, number>> {
    const db = getDb();
    const n = async (q: Promise<unknown[]>) => (await q).length;
    return {
      users: await n(db.select().from(users).where(eq(users.id, userId))),
      connected: await n(db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId))),
      sessions: await n(db.select().from(sessions).where(eq(sessions.userId, userId))),
      authTokens: await n(db.select().from(authTokens).where(eq(authTokens.userId, userId))),
      lists: await n(db.select().from(userLists).where(eq(userLists.userId, userId))),
      plays: await n(db.select().from(playRecords).where(eq(playRecords.userId, userId))),
      follows: await n(db.select().from(follows).where(eq(follows.userId, userId))),
      feeds: await n(db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, userId))),
    };
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv();
    platformId = (await upsertPlatform({ igdbId: 987901, slug: "t7-p1", name: "T7 P1", abbreviation: "T7P", kind: "console" })).id;
    platformIds.push(platformId);
    for (const k of ["a", "b", "c"]) await addGame(k);
    setAuditLogForTests((event, data) => audits.push({ event, data }));
  });

  beforeEach(() => {
    resetRateLimitsForTests();
    audits.length = 0;
  });

  afterAll(async () => {
    const db = getDb();
    setAuditLogForTests(undefined);
    await db.delete(users).where(like(users.email, "t7-%"));
    await db.delete(users).where(like(users.email, "%@t7.placeholder.invalid"));
    if (gameIds.length) {
      await db.delete(gamePlayerRatings).where(inArray(gamePlayerRatings.gameId, gameIds));
      await db.delete(games).where(inArray(games.id, gameIds));
    }
    if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    resetCoreEnvCache();
    await closeDb();
  });

  // ── 偏好 ─────────────────────────────────────────────────────────────────
  describe("偏好 GET|PATCH /account/preferences", () => {
    let A: Account;
    beforeAll(async () => {
      A = await signUp("t7-pref@example.com", "Pref Name");
    });

    it("401／403（Origin 先於登入）／405／no-store", async () => {
      expect((await handleAccountPreferences(request("GET", "/api/v1/account/preferences"))).status).toBe(401);
      expect((await patchPrefs(A, { locale: "en" }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await patchPrefs(A, { locale: "en" }, { origin: null })).status).toBe(403);
      expect((await patchPrefs({ cookie: "" }, { locale: "en" })).status).toBe(401);
      const post = await handleAccountPreferences(request("POST", "/api/v1/account/preferences", { cookie: A.cookie }));
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, PATCH");
      const ok = await getPrefs(A);
      expect(ok.headers.get("cache-control")).toBe("no-store");
    });

    it("預設值：顯示名稱＝註冊名稱，其餘沒設定；清單預設 private、評論預設 public", async () => {
      const body = await json(await getPrefs(A));
      expect(body.preferences).toMatchObject({
        displayName: "Pref Name",
        locale: null,
        preferredRegion: null,
        scoreProviders: null,
        preferredPlatformIds: [],
        defaultListVisibility: "private",
        defaultReviewVisibility: "public",
      });
    });

    it("驗證失敗：欄位原因碼、不存在的平台、空 body、無效 JSON", async () => {
      const bad = await patchPrefs(A, { locale: "fr", timezone: "UTC+8", preferredRegion: "ZZ", scoreProviders: ["nope"], defaultListVisibility: "x" });
      expect(bad.status).toBe(400);
      expect(await json(bad)).toEqual({
        code: "validation_failed",
        fields: { locale: "invalid", timezone: "invalid", preferredRegion: "invalid", scoreProviders: "invalid", defaultListVisibility: "invalid" },
      });
      const noPlatform = await patchPrefs(A, { preferredPlatformIds: [99999999] });
      expect(noPlatform.status).toBe(400);
      expect(await json(noPlatform)).toEqual({ code: "validation_failed", fields: { preferredPlatformIds: "invalid" } });
      const empty = await patchPrefs(A, {});
      expect(await json(empty)).toEqual({ code: "validation_failed", fields: { body: "empty" } });
      const badJson = await handleAccountPreferences(new Request(`${ORIGIN}/api/v1/account/preferences`, { method: "PATCH", headers: { origin: ORIGIN, cookie: A.cookie, "content-type": "application/json" }, body: "{" }));
      expect(badJson.status).toBe(400);
      expect(await json(badJson)).toEqual({ code: "invalid_json" });
      // 任一欄位驗證失敗，其他欄位都不寫入
      expect((await json(await getPrefs(A))).preferences.displayName).toBe("Pref Name");
    });

    it("PATCH 成功：寫入、changed 旗標、重送不變、null 清除", async () => {
      const first = await patchPrefs(A, {
        locale: "ja",
        timezone: "Asia/Tokyo",
        preferredRegion: "jp",
        scoreProviders: ["igdb"],
        preferredPlatformIds: [platformId],
        defaultListVisibility: "public",
        defaultReviewVisibility: "followers",
      });
      expect(first.status).toBe(200);
      const b1 = await json(first);
      expect(b1.changed).toBe(true);
      expect(b1.preferences).toMatchObject({ locale: "ja", timezone: "Asia/Tokyo", preferredRegion: "JP", scoreProviders: ["igdb"], preferredPlatformIds: [platformId], defaultListVisibility: "public", defaultReviewVisibility: "followers" });
      const [row] = await getDb().select().from(users).where(eq(users.id, A.id));
      expect(row).toMatchObject({ locale: "ja", timezone: "Asia/Tokyo", preferredRegion: "JP", defaultListVisibility: "public", defaultReviewVisibility: "followers" });

      const again = await json(await patchPrefs(A, { locale: "ja", preferredPlatformIds: [platformId] }));
      expect(again.changed).toBe(false);
      const [row2] = await getDb().select().from(users).where(eq(users.id, A.id));
      expect(row2!.updatedAt.getTime()).toBe(row!.updatedAt.getTime());

      const cleared = await json(await patchPrefs(A, { locale: null, timezone: null, preferredRegion: null, scoreProviders: null, preferredPlatformIds: [] }));
      expect(cleared.changed).toBe(true);
      expect(cleared.preferences).toMatchObject({ locale: null, timezone: null, preferredRegion: null, scoreProviders: null, preferredPlatformIds: [] });
      // 空陣列的 scoreProviders＝什麼都不顯示，和 null（沒設定）不同
      const none = await json(await patchPrefs(A, { scoreProviders: [] }));
      expect(none.preferences.scoreProviders).toEqual([]);
    });

    it("預設可見度生效：新清單／新評論沒指定時用偏好", async () => {
      await patchPrefs(A, { defaultListVisibility: "unlisted", defaultReviewVisibility: "private" });
      const list = await createListApi(A, { name: "Pref list" });
      expect(list.visibility).toBe("unlisted");
      const rec = await createPlayApi(A, { gameId: gid.c, status: "playing", review: "x" });
      expect(rec.reviewVisibility).toBe("private");
      const explicit = await createListApi(A, { name: "Explicit", visibility: "private" });
      expect(explicit.visibility).toBe("private");
    });

    it("改顯示名稱會重新發出 session cookie，header 馬上看到新名稱；其他欄位不發 cookie", async () => {
      const other = await patchPrefs(A, { timezone: "Asia/Taipei" });
      expect(other.headers.getSetCookie()).toEqual([]);
      const res = await patchPrefs(A, { displayName: "  Renamed  " });
      expect((await json(res)).preferences.displayName).toBe("Renamed");
      const setCookies = res.headers.getSetCookie();
      expect(setCookies.some((c) => c.includes("session_data"))).toBe(true);
      const fresh = `${tokenOnly(A.cookie)}; ${cookieOf(res)}`;
      const session = await handleAuthRequest(new Request(`${ORIGIN}${AUTH_BASE_PATH}/get-session`, { headers: { cookie: fresh } }));
      expect((await json(session)).user.name).toBe("Renamed");
    });
  });

  // ── 刪除帳號 ──────────────────────────────────────────────────────────────
  describe("DELETE /account", () => {
    it("401／403（Origin 先於登入）／405", async () => {
      const A = await signUp("t7-del-basic@example.com");
      expect((await del(A, { password: PASSWORD }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await del(A, { password: PASSWORD }, { origin: null })).status).toBe(403);
      expect((await del({ cookie: "" }, { password: PASSWORD })).status).toBe(401);
      const get = await handleAccountDelete(request("GET", "/api/v1/account", { cookie: A.cookie }));
      expect(get.status).toBe(405);
      expect(get.headers.get("allow")).toBe("DELETE");
      expect((await rowCounts(A.id)).users).toBe(1);
    });

    it("有密碼：沒帶 → 400 password required；錯 → 401 invalid_password；兩者都不刪", async () => {
      const A = await signUp("t7-del-pw@example.com");
      const none = await del(A);
      expect(none.status).toBe(400);
      expect(await json(none)).toEqual({ code: "validation_failed", fields: { password: "required" } });
      expect((await del(A, { password: "" })).status).toBe(400);
      const wrong = await del(A, { password: "not the password" });
      expect(wrong.status).toBe(401);
      expect(await json(wrong)).toEqual({ code: "invalid_password" });
      expect((await del(A, { password: 123 })).status).toBe(400);
      expect((await rowCounts(A.id)).users).toBe(1);
      expect(audits).toEqual([]);
    });

    it("限流：每使用者每小時 5 次（包含密碼錯誤的嘗試），超過 → 429 + Retry-After", async () => {
      const A = await signUp("t7-del-rate@example.com");
      for (let i = 0; i < ACCOUNT_DELETE_RATE_LIMIT.max; i++) expect((await del(A, { password: "wrong" })).status).toBe(401);
      const limited = await del(A, { password: PASSWORD });
      expect(limited.status).toBe(429);
      expect(await json(limited)).toEqual({ code: "rate_limited" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await rowCounts(A.id)).users).toBe(1);
    });

    it("成功：所有關聯表清空、私人 feed 404、session 失效、cookie 被清除、稽核 log 只有 userId 與時間", async () => {
      const A = await signUp("t7-del-all@example.com", "Delete Me");
      const second = await signIn(A.email); // 第二個 session（另一個裝置）
      const secondCookie = cookieOf(second);
      const { feedToken, listId, connectedAccountId } = await seedEverything(A);

      const before = await rowCounts(A.id);
      expect(before).toMatchObject({ users: 1, connected: 2, sessions: 2, authTokens: 1, lists: 1, plays: 1, follows: 1, feeds: 1 });
      expect((await getDb().select().from(userListGames).where(eq(userListGames.listId, listId))).length).toBe(1);
      expect((await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, connectedAccountId))).length).toBe(2);
      expect((await handlePrivateIcs(request("GET", `/ical/u/${feedToken}.ics`), `${feedToken}.ics`)).status).toBe(200);

      const res = await del(A, { password: PASSWORD });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true });
      expect(res.headers.get("cache-control")).toBe("no-store");

      expect(await rowCounts(A.id)).toEqual({ users: 0, connected: 0, sessions: 0, authTokens: 0, lists: 0, plays: 0, follows: 0, feeds: 0 });
      expect((await getDb().select().from(userListGames).where(eq(userListGames.listId, listId))).length).toBe(0);
      expect((await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, connectedAccountId))).length).toBe(0);

      // 私人 feed 回 404（不是空 ics、不是 410）
      const feed = await handlePrivateIcs(request("GET", `/ical/u/${feedToken}.ics`), `${feedToken}.ics`);
      expect(feed.status).toBe(404);

      // 兩個 session（含另一個裝置）都不能再用；API 回 401
      expect((await getPrefs(A)).status).toBe(401);
      expect((await getPrefs({ cookie: secondCookie })).status).toBe(401);
      expect((await handleAccountExport(request("GET", "/api/v1/account/export", { cookie: A.cookie }))).status).toBe(401);
      expect((await signIn(A.email)).status).toBe(401);

      // 回應清掉 session cookie（Max-Age=0 或已過期）
      const cleared = res.headers.getSetCookie();
      expect(cleared.length).toBeGreaterThan(0);
      expect(cleared.some((c) => c.includes("session_token"))).toBe(true);
      for (const c of cleared) expect(/max-age=0|expires=thu, 01 jan 1970/i.test(c), c).toBe(true);

      // 稽核 log：只有 userId 與時間
      expect(audits).toHaveLength(1);
      expect(audits[0]!.event).toBe("account_deleted");
      expect(Object.keys(audits[0]!.data as object).sort()).toEqual(["at", "userId"]);
      expect((audits[0]!.data as { userId: number }).userId).toBe(A.id);
      expect(JSON.stringify(audits)).not.toContain("t7-del-all");
      expect(JSON.stringify(audits)).not.toContain("Delete Me");
    });

    it("別人的資料不受影響", async () => {
      const A = await signUp("t7-del-iso-a@example.com");
      const B = await signUp("t7-del-iso-b@example.com");
      await seedEverything(B);
      const before = await rowCounts(B.id);
      expect((await del(A, { password: PASSWORD })).status).toBe(200);
      expect(await rowCounts(B.id)).toEqual(before);
    });

    it("沒有密碼的帳號：session 不夠新 → 401 reauth_required（不刪）；夠新 → 刪除成功", async () => {
      const A = await signUp("t7-del-nopw@example.com");
      // 變成「只有社群登入」的帳號（沒有 credential 列）
      await getDb().delete(connectedAccounts).where(and(eq(connectedAccounts.userId, A.id), eq(connectedAccounts.provider, "credential")));
      await getDb().insert(connectedAccounts).values({ userId: A.id, provider: "discord", providerAccountId: `d-${A.id}` });
      const cookie = tokenOnly(A.cookie);

      await getDb().update(sessions).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(sessions.userId, A.id));
      const stale = await del({ cookie });
      expect(stale.status).toBe(401);
      expect(await json(stale)).toEqual({ code: "reauth_required" });
      // 帶密碼也沒用（沒有密碼可驗證，仍要求新的 session）
      expect((await del({ cookie }, { password: PASSWORD })).status).toBe(401);
      expect((await rowCounts(A.id)).users).toBe(1);

      await getDb().update(sessions).set({ createdAt: new Date(Date.now() - 9 * 60_000) }).where(eq(sessions.userId, A.id));
      const fresh = await del({ cookie });
      expect(fresh.status).toBe(200);
      expect((await rowCounts(A.id)).users).toBe(0);
      expect(audits).toHaveLength(1);
    });
  });

  // ── 匯出 ──────────────────────────────────────────────────────────────────
  describe("GET /account/export", () => {
    let A: Account;
    let feedToken = "";
    const MALICIOUS_LIST = '=HYPERLINK("http://evil.example","click")';
    beforeAll(async () => {
      A = await signUp("t7-export@example.com", "Export Me");
      const seeded = await seedEverything(A);
      feedToken = seeded.feedToken;
      // 公式注入、逗號、引號、換行
      const evil = await createListApi(A, { name: MALICIOUS_LIST, description: "-1+1\nsecond, line \"quoted\"" });
      await addToListApi(A, evil.id, gid.b!, "@SUM(A1:A9)");
      await createPlayApi(A, { gameId: gid.b, status: "paused", privateNote: "+cmd|' /C calc'!A0", review: "=1+1" });
    });

    it("401／405／格式與分段驗證", async () => {
      expect((await handleAccountExport(request("GET", "/api/v1/account/export"))).status).toBe(401);
      const post = await handleAccountExport(request("POST", "/api/v1/account/export", { cookie: A.cookie }));
      expect(post.status).toBe(405);
      expect((await exportReq(A, "?format=xml")).status).toBe(400);
      const noPart = await exportReq(A, "?format=csv");
      expect(await json(noPart)).toEqual({ code: "validation_failed", fields: { part: "required" } });
      const badPart = await exportReq(A, "?format=csv&part=passwords");
      expect(await json(badPart)).toEqual({ code: "validation_failed", fields: { part: "invalid" } });
    });

    it("JSON：附件下載、no-store、結構完整、含私人筆記與遊戲名稱", async () => {
      const res = await exportReq(A);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="sok-export-\d{4}-\d{2}-\d{2}\.json"$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.getSetCookie()).toEqual([]);
      const data = await json(res);
      expect(data.exportVersion).toBe(1);
      expect(data.profile).toMatchObject({ id: A.id, displayName: "Export Me", email: "t7-export@example.com", emailIsPlaceholder: false, role: "member" });
      expect(data.preferences).toMatchObject({ defaultListVisibility: "private", defaultReviewVisibility: "public" });
      expect(data.connections.map((c: J) => c.provider).sort()).toEqual(["credential", "steam"]);
      expect(Object.keys(data.connections[0]).sort()).toEqual(["connectedAt", "provider"]);

      const names = data.lists.map((l: J) => l.name);
      expect(names).toEqual(expect.arrayContaining(["Everything", MALICIOUS_LIST]));
      const everything = data.lists.find((l: J) => l.name === "Everything");
      expect(everything.games).toEqual([expect.objectContaining({ gameId: gid.a, gameSlug: "t7-a", gameName: "T7 a", note: "list note" })]);
      expect(Object.keys(everything)).not.toContain("shareToken");

      const rec = data.playRecords.find((p: J) => p.gameId === gid.a);
      expect(rec).toMatchObject({ status: "finished", rating: 7.5, review: "great", privateNote: "my secret note", gameSlug: "t7-a", playMinutes: 90 });
      expect(data.follows).toEqual([expect.objectContaining({ targetType: "game", targetId: gid.b, targetSlug: "t7-b" })]);
      expect(data.ownedGames).toHaveLength(2);
      expect(data.ownedGames.find((o: J) => o.externalGameId === "1")).toMatchObject({ provider: "steam", status: "matched", matchedGameSlug: "t7-a", matchMethod: "auto" });
      expect(data.ownedGames.find((o: J) => o.externalGameId === "2")).toMatchObject({ status: "not_found", matchedGameId: null });
      expect(data.privateCalendar).toMatchObject({ feedType: "following", includeReleases: true, includeEvents: true });
    });

    it("JSON 不含密碼雜湊、任何 token（OAuth、feed token、feed 雜湊／密文、分享 token、session）", async () => {
      const text = await (await exportReq(A)).text();
      const [cred] = await getDb().select().from(connectedAccounts).where(and(eq(connectedAccounts.userId, A.id), eq(connectedAccounts.provider, "credential")));
      expect(cred!.password).toBeTruthy();
      expect(text).not.toContain(cred!.password!);
      expect(text).not.toContain("$argon2");
      expect(text).not.toContain("SECRET-ACCESS-TOKEN");
      expect(text).not.toContain(feedToken);
      const [feed] = await getDb().select().from(calendarFeeds).where(eq(calendarFeeds.userId, A.id));
      expect(text).not.toContain(feed!.tokenHash);
      expect(text).not.toContain(feed!.tokenCiphertext!);
      const [list] = await getDb().select().from(userLists).where(and(eq(userLists.userId, A.id), eq(userLists.name, "Everything")));
      expect(list!.shareToken).toBeTruthy();
      expect(text).not.toContain(list!.shareToken!);
      const [sess] = await getDb().select().from(sessions).where(eq(sessions.userId, A.id));
      expect(text).not.toContain(sess!.token);
      const keys = new Set<string>();
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      };
      walk(JSON.parse(text));
      for (const banned of ["password", "token", "accessToken", "refreshToken", "idToken", "tokenHash", "tokenCiphertext", "shareToken", "url"]) expect(keys.has(banned), banned).toBe(false);
    });

    it("沒有信箱的帳號：照實標示 placeholder", async () => {
      const P = await signUp("t7-export-placeholder@example.com");
      const placeholder = `${P.id}@t7.placeholder.invalid`;
      await getDb().update(users).set({ email: placeholder }).where(eq(users.id, P.id));
      const data = await json(await exportReq(P));
      expect(data.profile).toMatchObject({ email: placeholder, emailIsPlaceholder: true });
    });

    it("CSV：每段 UTF-8 BOM、CRLF、attachment；表頭欄位與資料列數正確", async () => {
      const expectRows: Record<string, number> = { profile: 1, lists: 2, list_games: 2, plays: 2, follows: 1, owned_games: 2 };
      for (const [part, rows] of Object.entries(expectRows)) {
        const res = await exportReq(A, `?format=csv&part=${part}`);
        expect(res.status, part).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/csv; charset=utf-8/);
        expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="sok-${part}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
        expect(res.headers.get("cache-control")).toBe("no-store");
        const bytes = new Uint8Array(await res.clone().arrayBuffer());
        expect([...bytes.slice(0, 3)], part).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
        const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
        expect(text.startsWith("﻿"), part).toBe(true);
        expect(text.endsWith("\r\n"), part).toBe(true);
        const parsed = parseCsv(text);
        expect(parsed.length - 1, part).toBe(rows);
        const width = parsed[0]!.length;
        for (const r of parsed) expect(r.length, `${part} 欄數一致`).toBe(width);
      }
    });

    it("CSV 公式注入：以 = + - @ 開頭的使用者輸入加單引號，逗號／引號／換行正確跳脫（解析後可還原）", async () => {
      const lists = parseCsv(await (await exportReq(A, "?format=csv&part=lists")).text());
      const header = lists[0]!;
      const evil = lists.find((r) => r[header.indexOf("name")]!.includes("HYPERLINK"))!;
      expect(evil[header.indexOf("name")]).toBe(`'${MALICIOUS_LIST}`);
      expect(evil[header.indexOf("description")]).toBe("'-1+1\nsecond, line \"quoted\"");

      const listGames = parseCsv(await (await exportReq(A, "?format=csv&part=list_games")).text());
      const lh = listGames[0]!;
      expect(listGames.some((r) => r[lh.indexOf("note")] === "'@SUM(A1:A9)")).toBe(true);

      const plays = parseCsv(await (await exportReq(A, "?format=csv&part=plays")).text());
      const ph = plays[0]!;
      const evilPlay = plays.find((r) => r[ph.indexOf("status")] === "paused")!;
      expect(evilPlay[ph.indexOf("private_note")]).toBe("'+cmd|' /C calc'!A0");
      expect(evilPlay[ph.indexOf("review")]).toBe("'=1+1");
      const rated = plays.find((r) => r[ph.indexOf("status")] === "finished")!;
      expect(rated[ph.indexOf("rating")]).toBe("7.5");
      expect(rated[ph.indexOf("private_note")]).toBe("my secret note");

      // 沒有任何儲存格以公式字元開頭（除了加了單引號的）
      for (const part of ["profile", "lists", "list_games", "plays", "follows", "owned_games"]) {
        const rows = parseCsv(await (await exportReq(A, `?format=csv&part=${part}`)).text());
        for (const row of rows.slice(1)) for (const cell of row) expect(/^[=+\-@\t\r]/.test(cell), `${part}: ${cell}`).toBe(false);
      }
    });

    it("CSV 也不含機密", async () => {
      for (const part of ["profile", "lists", "list_games", "plays", "follows", "owned_games"]) {
        const text = await (await exportReq(A, `?format=csv&part=${part}`)).text();
        expect(text, part).not.toContain("$argon2");
        expect(text, part).not.toContain(feedToken);
        expect(text, part).not.toContain("SECRET-ACCESS-TOKEN");
      }
    });

    it("限流：每使用者每小時 12 次，超過 → 429；別人不受影響", async () => {
      resetRateLimitsForTests();
      const B = await signUp("t7-export-rate@example.com");
      for (let i = 0; i < ACCOUNT_EXPORT_RATE_LIMIT.max; i++) expect((await exportReq(B, "?format=csv&part=profile")).status).toBe(200);
      const limited = await exportReq(B);
      expect(limited.status).toBe(429);
      expect(await json(limited)).toEqual({ code: "rate_limited" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await exportReq(A, "?format=csv&part=profile")).status).toBe(200);
    });
  });

  // ── 停權 ──────────────────────────────────────────────────────────────────
  describe("停權", () => {
    it("撤銷所有 session、冪等、可解除；稽核 log 只有 userId 與時間；不存在 → user_not_found", async () => {
      const S = await signUp("t7-susp-basic@example.com");
      await signIn(S.email);
      expect((await rowCounts(S.id)).sessions).toBe(2);
      const first = await adminSetSuspended(S.id, true);
      expect(first).toEqual({ ok: true, changed: true, revokedSessions: 2 });
      expect((await rowCounts(S.id)).sessions).toBe(0);
      const [row] = await getDb().select().from(users).where(eq(users.id, S.id));
      expect(row!.suspendedAt).not.toBeNull();
      // 沒有 session cookie cache 的請求立刻被拒
      expect((await getPrefs({ cookie: tokenOnly(S.cookie) })).status).toBe(401);

      const again = await adminSetSuspended(S.id, true);
      expect(again).toEqual({ ok: true, changed: false, revokedSessions: 0 });
      const [row2] = await getDb().select().from(users).where(eq(users.id, S.id));
      expect(row2!.suspendedAt!.getTime()).toBe(row!.suspendedAt!.getTime());

      expect(await adminSetSuspended(S.id, false)).toEqual({ ok: true, changed: true, revokedSessions: 0 });
      expect((await getDb().select().from(users).where(eq(users.id, S.id)))[0]!.suspendedAt).toBeNull();
      expect(audits.map((a) => a.event)).toEqual(["user_suspended", "user_unsuspended"]);
      for (const a of audits) expect(Object.keys(a.data as object).sort()).toEqual(["at", "userId"]);
      expect(await adminSetSuspended(999999999, true)).toEqual({ ok: false, code: "user_not_found" });
    });

    it("停權者：追蹤不計熱度、玩家平均不計、公開與分享連結清單對他人 404；解除後恢復", async () => {
      const S = await signUp("t7-susp-effects@example.com");
      const V = await signUp("t7-susp-viewer@example.com");
      await followApi(S, "game", gid.c!);
      await followApi(V, "game", gid.c!);
      await createPlayApi(S, { gameId: gid.c, status: "finished", ratingHalfSteps: 18 });
      await createPlayApi(V, { gameId: gid.c, status: "finished", ratingHalfSteps: 10 });
      const pub = await createListApi(S, { name: "Pub", visibility: "public" });
      const unl = await createListApi(S, { name: "Unl", visibility: "unlisted" });

      const signalFor = async () => ((await siteFollowsSignal.fetch({ gameIds: [gid.c!] })) as Array<{ gameId: number; value: number }>).find((r) => r.gameId === gid.c)?.value ?? 0;
      const ratingFor = async () => {
        await runRefreshPlayerRatings();
        const [r] = await getDb().select().from(gamePlayerRatings).where(eq(gamePlayerRatings.gameId, gid.c!));
        return r ? { count: r.ratingCount, avg: Number(r.avgHalfSteps) } : null;
      };
      const readPublic = async () => (await handleList(request("GET", `/api/v1/lists/${pub.id}`), String(pub.id))).status;
      const readShared = async () => (await handleSharedList(request("GET", `/api/v1/lists/shared/${unl.shareToken}`), unl.shareToken)).status;

      expect(await signalFor()).toBe(2);
      expect(await ratingFor()).toEqual({ count: 2, avg: 14 });
      expect(await readPublic()).toBe(200);
      expect(await readShared()).toBe(200);

      await adminSetSuspended(S.id, true);
      expect(await signalFor()).toBe(1);
      expect(await ratingFor()).toEqual({ count: 1, avg: 10 });
      expect(await readPublic()).toBe(404);
      expect(await readShared()).toBe(404);

      await adminSetSuspended(S.id, false);
      expect(await signalFor()).toBe(2);
      expect(await ratingFor()).toEqual({ count: 2, avg: 14 });
      expect(await readPublic()).toBe(200);
    });

    it("停權者仍可重新登入、讀寫自己的資料、匯出與刪除帳號（最小可回退；待決）", async () => {
      const S = await signUp("t7-susp-still@example.com");
      await createListApi(S, { name: "Mine" });
      await adminSetSuspended(S.id, true);
      const login = await signIn(S.email);
      expect(login.status).toBe(200);
      const again = { ...S, cookie: cookieOf(login) };
      expect((await getPrefs(again)).status).toBe(200);
      expect((await patchPrefs(again, { timezone: "UTC" })).status).toBe(200);
      expect((await handleLists(request("GET", "/api/v1/lists", { cookie: again.cookie }))).status).toBe(200);
      const exported = await json(await exportReq(again));
      expect(exported.lists.map((l: J) => l.name)).toEqual(["Mine"]);
      expect((await del(again, { password: PASSWORD })).status).toBe(200);
      expect((await rowCounts(S.id)).users).toBe(0);
    });
  });

  // ── /internal/users 的 POST ───────────────────────────────────────────────
  describe("POST /internal/users/{id}", () => {
    const deps = { verifyCsrfToken, isSameOrigin };
    const basic = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64")}`;
    const post = (id: string | number, form: Record<string, string>, headers: Record<string, string> = {}) =>
      handleAdminUserAction(
        new Request(`${ORIGIN}/internal/users/${id}`, { method: "POST", headers: { authorization: basic, origin: ORIGIN, host: "localhost:3000", ...headers }, body: new URLSearchParams(form) }),
        String(id),
        deps,
      );

    it("Basic auth → 同源 → CSRF → 動作，依序檢查", async () => {
      const U = await signUp("t7-admin-target@example.com");
      const csrf = createCsrfToken(ADMIN_PASS);
      const base = { action: "suspend", csrf };
      expect((await post(U.id, base, { authorization: "" })).status).toBe(401);
      expect((await post(U.id, base, { authorization: `Basic ${Buffer.from("x:y").toString("base64")}` })).status).toBe(401);
      expect((await post(U.id, base, { origin: "https://evil.example" })).status).toBe(403);
      expect((await post(U.id, { action: "suspend" })).status).toBe(403);
      expect((await post(U.id, { action: "suspend", csrf: createCsrfToken("wrong-secret") })).status).toBe(403);
      expect((await post(U.id, { action: "delete", csrf })).status).toBe(400);
      expect((await post("abc", base)).status).toBe(400);
      expect((await getDb().select().from(users).where(eq(users.id, U.id)))[0]!.suspendedAt).toBeNull();
    });

    it("停權／解除：303 回到 /internal/users 並帶結果；no-store、noindex；不存在 → error", async () => {
      const U = await signUp("t7-admin-target2@example.com");
      await signIn(U.email);
      const csrf = createCsrfToken(ADMIN_PASS);
      const res = await post(U.id, { action: "suspend", csrf, q: "t7-admin" });
      expect(res.status).toBe(303);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      const loc = new URL(res.headers.get("location")!, ORIGIN);
      expect(loc.pathname).toBe("/internal/users");
      expect(Object.fromEntries(loc.searchParams)).toEqual({ q: "t7-admin", done: "suspend", id: String(U.id), revoked: "2" });
      expect((await getDb().select().from(users).where(eq(users.id, U.id)))[0]!.suspendedAt).not.toBeNull();
      expect((await rowCounts(U.id)).sessions).toBe(0);

      const repeat = new URL((await post(U.id, { action: "suspend", csrf })).headers.get("location")!, ORIGIN);
      expect(repeat.searchParams.get("unchanged")).toBe("1");

      const un = new URL((await post(U.id, { action: "unsuspend", csrf })).headers.get("location")!, ORIGIN);
      expect(Object.fromEntries(un.searchParams)).toEqual({ done: "unsuspend", id: String(U.id) });
      expect((await getDb().select().from(users).where(eq(users.id, U.id)))[0]!.suspendedAt).toBeNull();

      const missing = new URL((await post(999999999, { action: "suspend", csrf })).headers.get("location")!, ORIGIN);
      expect(missing.searchParams.get("error")).toBe("user_not_found");
    });

    it("admin 模組停用或帳密未設 → 404（沿用 admin gate）", async () => {
      const csrf = createCsrfToken(ADMIN_PASS);
      const U = await signUp("t7-admin-target3@example.com");
      process.env.MODULES = "accounts";
      try {
        expect((await post(U.id, { action: "suspend", csrf })).status).toBe(404);
      } finally {
        delete process.env.MODULES;
      }
      delete process.env.ADMIN_BASIC_AUTH_PASS;
      try {
        expect((await post(U.id, { action: "suspend", csrf })).status).toBe(404);
      } finally {
        process.env.ADMIN_BASIC_AUTH_PASS = ADMIN_PASS;
      }
    });
  });

  it("共用 SQL 小檢查：測試資料庫沒有殘留 t7- 帳號以外的 feed", async () => {
    const rows = await getDb().execute(sql`SELECT count(*)::int AS n FROM calendar_feeds WHERE user_id NOT IN (SELECT id FROM users)`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});
