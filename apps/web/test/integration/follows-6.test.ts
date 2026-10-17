/**
 * Phase 7 第 6 波整合測試（真實 PG；handler 直接呼叫，不經 HTTP）：
 * 追蹤（冪等、目標不存在、每日上限、人數門檻與停權、孤兒清理）、熱度訊號與 wSite、/trending 依 7 日、詳情的 followerCount／rising、
 * GameFilterProvider 與 me/games、私人 iCal（建立冪等、rotate、ETag／304、內容規則、Set-Cookie）。
 * 信箱一律 fl6- 開頭；遊戲 slug 前綴 fl6-；igdbId 986xxx。日期以「今天」為基準的相對值（handler 不能注入時間）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { resetCoreEnvCache } from "@/kernel/config/env";
import {
  getGameDetail,
  getTrending,
  setCatalogExtensions,
  getCatalogExtensions,
  type ExternalHypeSource,
} from "@/modules/catalog";
import { companies, eventGames, events, franchises, gameCompanies, gameFranchises, gameGenres, gamePlatforms, games, genres, regions, releaseEvents } from "@/modules/catalog/schema";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { platforms } from "@/modules/catalog/schema";
import { refreshPopularity } from "@/modules/catalog/use-cases/sync/refresh-popularity";
import { POPULARITY_STATE } from "@/modules/catalog/use-cases/sync/refresh-popularity";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { utcToday } from "@/modules/catalog/domain/utc-date";
import { calendarFeeds, connectedAccounts, follows, ownedGames, users } from "@/modules/accounts/schema";
import { AUTH_BASE_PATH } from "@/modules/accounts/providers/auth";
import { handleAuthRequest, resetAuthForTests } from "@/modules/accounts/use-cases";
import { addToList, createList } from "@/modules/accounts/use-cases/lists";
import {
  handleFollowCount,
  handleFollowState,
  handleFollowTarget,
  handleFollows,
  handleMyGames,
} from "@/modules/accounts/use-cases/follow-request";
import { handleFeed, handleFeedRotate, handleFeeds, handlePrivateIcs } from "@/modules/accounts/use-cases/feed-request";
import { cleanupOrphanFollows, ORPHAN_SANITY_MIN_TARGETS } from "@/modules/accounts/use-cases/follows";
import { siteFollows7dSignal, siteFollowsSignal } from "@/modules/accounts/use-cases/catalog-extensions";
import { hashFeedToken } from "@/modules/accounts/use-cases/calendar-feeds";
import { parseIcs } from "../helpers/ics";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "a long password 1";
const ENV_KEYS = [
  "AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES",
  "FOLLOW_MAX_PER_DAY", "FOLLOW_COUNT_MIN_DISPLAY", "FOLLOW_RISING_MIN_7D", "ICAL_PUBLIC_MAX_EVENTS",
] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  delete process.env.MODULES;
  delete process.env.FOLLOW_MAX_PER_DAY;
  delete process.env.FOLLOW_COUNT_MIN_DISPLAY;
  delete process.env.FOLLOW_RISING_MIN_7D;
  delete process.env.ICAL_PUBLIC_MAX_EVENTS;
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
  cookie: string;
}

async function signUp(email: string): Promise<Account> {
  const res = await handleAuthRequest(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-up/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name: "Fl6 Tester" }),
    }),
  );
  expect(res.status).toBe(200);
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  return { id: u!.id, cookie: cookieOf(res) };
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

/** 今天（UTC）起算 n 天的日期字串。 */
function day(n: number): string {
  const d = new Date(`${utcToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const at = (n: number): Date => new Date(Date.now() + n * 86_400_000);

describe.skipIf(!enabled)("accounts 第 6 波：追蹤、熱度訊號、我的遊戲、私人 iCal", () => {
  let A: Account, B: Account, C: Account;
  const gid: Record<string, number> = {};
  const gameIds: number[] = [];
  const eventIds: Record<string, number> = {};
  const extraUserIds: number[] = [];
  let p1 = 0, p2 = 0, companyId = 0, franchiseId = 0;
  let wwId = 0;
  const platformIds: number[] = [];

  async function addGame(key: string, o: { platform: number; date: string; popularity?: number; heat?: number; status?: "scheduled" | "released" }): Promise<number> {
    const db = getDb();
    const name = `Fl6 ${key}`;
    const [g] = await db
      .insert(games)
      .values({
        igdbId: 986000 + gameIds.length + 1,
        slug: `fl6-${key}`,
        name,
        searchText: buildSearchText([name]),
        firstReleaseDate: o.date,
        firstReleasePrecision: "day",
        popularityScore: o.popularity ?? 0,
        heatLevel: o.heat ?? 0,
      })
      .returning({ id: games.id });
    gid[key] = g!.id;
    gameIds.push(g!.id);
    await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: o.platform });
    await db.insert(releaseEvents).values({
      gameId: g!.id,
      platformId: o.platform,
      regionId: wwId,
      releaseDate: o.date,
      periodStart: o.date,
      precision: "day",
      releaseStage: "full",
      status: o.status ?? "scheduled",
      source: "igdb",
    });
    return g!.id;
  }

  const follow = (acc: Account, type: string, id: number, o: CallOpts = {}) =>
    handleFollowTarget(request("PUT", `/api/v1/follows/${type}/${id}`, { cookie: acc.cookie, ...o }), type, String(id));
  const unfollow = (acc: Account, type: string, id: number) =>
    handleFollowTarget(request("DELETE", `/api/v1/follows/${type}/${id}`, { cookie: acc.cookie }), type, String(id));
  const getFeed = async (acc: Account) => (await json(await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: acc.cookie })))).feed as J;
  const tokenOf = (url: string) => /\/ical\/u\/([A-Za-z0-9_-]{43})\.ics$/.exec(url)![1]!;
  const ics = (token: string, headers?: Record<string, string>) => handlePrivateIcs(request("GET", `/ical/u/${token}.ics`, { headers }), `${token}.ics`);
  const gameIdsInIcs = (text: string): number[] =>
    parseIcs(text).events.flatMap((e) => {
      const m = /^release-g(\d+)-/.exec(e.get("UID") ?? "");
      return m ? [Number(m[1])] : [];
    }).sort((a, b) => a - b);
  const sorted = (...ids: number[]) => [...ids].sort((a, b) => a - b);

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv();
    const db = getDb();
    wwId = (await db.select().from(regions).where(eq(regions.code, "WW")))[0]!.id;
    p1 = (await upsertPlatform({ igdbId: 986901, slug: "fl6-p1", name: "Fl6 P1", abbreviation: "FP1", kind: "console" })).id;
    p2 = (await upsertPlatform({ igdbId: 986902, slug: "fl6-p2", name: "Fl6 P2", kind: "pc" })).id;
    platformIds.push(p1, p2);

    await addGame("a", { platform: p1, date: day(10), popularity: 900, heat: 3 });
    await addGame("b", { platform: p1, date: day(200), popularity: 50, heat: 1 });
    await addGame("c", { platform: p1, date: day(-10), status: "released", popularity: 40 });
    await addGame("d", { platform: p1, date: day(-60), status: "released", popularity: 30 });
    await addGame("e", { platform: p2, date: day(20), popularity: 500, heat: 2 });
    await addGame("f", { platform: p1, date: day(30), popularity: 20 });
    await addGame("g", { platform: p2, date: day(40), popularity: 100, heat: 1 });

    const [co] = await db.insert(companies).values({ igdbId: 986801, name: "Fl6 Co", slug: "fl6-co" }).returning({ id: companies.id });
    companyId = co!.id;
    await db.insert(gameCompanies).values({ gameId: gid.e!, companyId, role: "developer" });
    const [fr] = await db.insert(franchises).values({ igdbId: 986802, kind: "franchise", name: "Fl6 Fr", slug: "fl6-fr" }).returning({ id: franchises.id });
    franchiseId = fr!.id;
    await db.insert(gameFranchises).values({ gameId: gid.e!, franchiseId });

    const ev = async (key: string, startDays: number, relatedTo?: string) => {
      const [e] = await db
        .insert(events)
        .values({ name: `Fl6 Event ${key}`, slug: `fl6-event-${key}`, startTime: at(startDays), endTime: at(startDays + 0.1) })
        .returning({ id: events.id });
      eventIds[key] = e!.id;
      if (relatedTo) await db.insert(eventGames).values({ eventId: e!.id, gameId: gid[relatedTo]! });
    };
    await ev("a", 15); // 明確追蹤的活動
    await ev("b", 25, "a"); // 與遊戲 a 相關
    await ev("c", 12, "f"); // 與多數測試沒追蹤的遊戲相關

    A = await signUp("fl6-a@example.com");
    B = await signUp("fl6-b@example.com");
    C = await signUp("fl6-c@example.com");
    setCatalogExtensions({ popularitySignals: [siteFollowsSignal, siteFollows7dSignal] });
  });

  afterAll(async () => {
    const db = getDb();
    setCatalogExtensions({});
    await db.execute(sql`DELETE FROM sync_state WHERE job_name = ${POPULARITY_STATE}`);
    await db.delete(users).where(like(users.email, "fl6-%"));
    if (extraUserIds.length) await db.delete(users).where(inArray(users.id, extraUserIds));
    if (gameIds.length) await db.delete(games).where(inArray(games.id, gameIds));
    for (const id of Object.values(eventIds)) await db.delete(events).where(eq(events.id, id));
    await db.delete(genres).where(like(genres.slug, "fl6-%"));
    await db.delete(franchises).where(eq(franchises.id, franchiseId));
    await db.delete(companies).where(eq(companies.id, companyId));
    if (platformIds.length) await db.delete(platforms).where(inArray(platforms.id, platformIds));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    resetCoreEnvCache();
    await closeDb();
  });

  // ── 追蹤 API ─────────────────────────────────────────────────────────────
  describe("follows API", () => {
    it("401／403（Origin 先於登入）／405／no-store", async () => {
      const bad = await follow(A, "game", gid.a!, { origin: "https://evil.example" });
      expect(bad.status).toBe(403);
      expect(await json(bad)).toEqual({ code: "invalid_origin" });
      expect((await follow(A, "game", gid.a!, { origin: null })).status).toBe(403);
      const anon = await handleFollowTarget(request("PUT", `/api/v1/follows/game/${gid.a}`), "game", String(gid.a));
      expect(anon.status).toBe(401);
      expect(anon.headers.get("cache-control")).toBe("no-store");
      expect((await handleFollows(request("GET", "/api/v1/follows"))).status).toBe(401);
      expect((await handleFollowState(request("GET", "/api/v1/me/follows/state?targets=game:1"))).status).toBe(401);
      expect((await handleMyGames(request("GET", "/api/v1/me/games?mine=followed"))).status).toBe(401);
      expect((await handleFollows(request("POST", "/api/v1/follows", { cookie: A.cookie }))).status).toBe(405);
      expect((await handleFollowTarget(request("POST", "/x", { cookie: A.cookie }), "game", "1")).status).toBe(405);
    });

    it("PUT 冪等：新增 201、已追蹤 200；DELETE 冪等；五種目標都能追蹤", async () => {
      const first = await follow(A, "game", gid.a!);
      expect(first.status).toBe(201);
      expect(await json(first)).toEqual({ following: true, created: true });
      const again = await follow(A, "game", gid.a!);
      expect(again.status).toBe(200);
      expect(await json(again)).toEqual({ following: true, created: false });
      expect((await getDb().select().from(follows).where(and(eq(follows.userId, A.id), eq(follows.targetId, gid.a!)))).length).toBe(1);

      for (const [type, id] of [["event", eventIds.a!], ["platform", p2], ["franchise", franchiseId], ["company", companyId]] as const) {
        expect((await follow(A, type, id)).status).toBe(201);
      }
      const del = await unfollow(A, "company", companyId);
      expect(await json(del)).toEqual({ following: false, removed: true });
      const del2 = await unfollow(A, "company", companyId);
      expect(del2.status).toBe(200);
      expect(await json(del2)).toEqual({ following: false, removed: false });
      await follow(A, "company", companyId);
      await unfollow(A, "platform", p2);
      await unfollow(A, "franchise", franchiseId);
      await unfollow(A, "company", companyId);
      await unfollow(A, "event", eventIds.a!);
      await unfollow(A, "game", gid.a!);
    });

    it("目標不存在／路徑不合法 → 404 target_not_found；mobile 平台不可追蹤", async () => {
      for (const [type, id] of [["game", "99999999"], ["event", "99999999"], ["platform", "99999999"], ["franchise", "99999999"], ["company", "99999999"], ["nope", "1"], ["game", "abc"], ["game", "0"]]) {
        const res = await handleFollowTarget(request("PUT", `/api/v1/follows/${type}/${id}`, { cookie: A.cookie }), type, id);
        expect(res.status).toBe(404);
        expect(await json(res)).toEqual({ code: "target_not_found" });
      }
      const [m] = await getDb().insert(platforms).values({ name: "Fl6 Mobile", slug: "fl6-mobile", kind: "mobile" }).returning({ id: platforms.id });
      platformIds.push(m!.id);
      expect((await follow(A, "platform", m!.id)).status).toBe(404);
    });

    it("GET /follows：本人清單（新到舊）、帶目標資訊、可依種類過濾、分頁", async () => {
      await follow(A, "game", gid.a!);
      await follow(A, "event", eventIds.a!);
      await follow(A, "platform", p1);
      await follow(A, "franchise", franchiseId);
      await follow(A, "company", companyId);
      const res = await handleFollows(request("GET", "/api/v1/follows?locale=en", { cookie: A.cookie }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await json(res);
      expect(body.items).toHaveLength(5);
      expect(body.hasMore).toBe(false);
      const byType = Object.fromEntries(body.items.map((i: J) => [i.targetType, i]));
      expect(byType.game.target).toMatchObject({ slug: "fl6-a", name: "Fl6 a", firstReleaseDate: day(10) });
      expect(byType.event.target).toMatchObject({ slug: "fl6-event-a", startTime: expect.any(String), kind: "other" });
      expect(byType.platform.target).toMatchObject({ slug: "fl6-p1", abbreviation: "FP1", kind: "console" });
      expect(byType.franchise.target).toMatchObject({ slug: "fl6-fr", name: "Fl6 Fr", kind: "franchise" });
      expect(byType.company.target).toMatchObject({ slug: "fl6-co", kind: null });
      expect(byType.game.target.kind).toBeNull();
      expect(typeof byType.game.followedAt).toBe("string");
      const onlyGames = await json(await handleFollows(request("GET", "/api/v1/follows?targetType=game", { cookie: A.cookie })));
      expect(onlyGames.items.map((i: J) => i.targetType)).toEqual(["game"]);
      const page = await json(await handleFollows(request("GET", "/api/v1/follows?limit=2&offset=0", { cookie: A.cookie })));
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect((await handleFollows(request("GET", "/api/v1/follows?targetType=bad", { cookie: A.cookie }))).status).toBe(400);
      expect((await handleFollows(request("GET", "/api/v1/follows?limit=0", { cookie: A.cookie }))).status).toBe(400);
      // 別人看不到：B 的清單是空的（沒有任何讀別人追蹤清單的端點）
      expect((await json(await handleFollows(request("GET", "/api/v1/follows", { cookie: B.cookie })))).items).toEqual([]);
      for (const [t, i] of [["game", gid.a!], ["event", eventIds.a!], ["platform", p1], ["franchise", franchiseId], ["company", companyId]] as const) await unfollow(A, t, i);
    });

    it("每日上限 FOLLOW_MAX_PER_DAY：滾動 24 小時；已追蹤的重送不計；超過 → 429 follow_limit_reached", async () => {
      process.env.FOLLOW_MAX_PER_DAY = "3";
      try {
        for (const k of ["a", "b", "c"]) expect((await follow(C, "game", gid[k]!)).status).toBe(201);
        const over = await follow(C, "game", gid.d!);
        expect(over.status).toBe(429);
        expect(await json(over)).toEqual({ code: "follow_limit_reached" });
        expect((await follow(C, "game", gid.a!)).status).toBe(200); // 冪等：不受上限影響
        // 一筆超過 24 小時 → 視窗內只剩 2 筆，又能新增
        await getDb().update(follows).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(and(eq(follows.userId, C.id), eq(follows.targetId, gid.a!)));
        expect((await follow(C, "game", gid.d!)).status).toBe(201);
        expect((await follow(C, "game", gid.e!)).status).toBe(429);
      } finally {
        delete process.env.FOLLOW_MAX_PER_DAY;
        await getDb().delete(follows).where(eq(follows.userId, C.id));
      }
    });

    it("me/follows/state：一次回多個目標；withCount 帶公開人數（門檻內 null）；參數驗證", async () => {
      await follow(A, "game", gid.a!);
      const res = await handleFollowState(request("GET", `/api/v1/me/follows/state?targets=game:${gid.a},game:${gid.b},event:${eventIds.a},game:${gid.a}`, { cookie: A.cookie }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await json(res)).items).toEqual([
        { targetType: "game", targetId: gid.a, following: true },
        { targetType: "game", targetId: gid.b, following: false },
        { targetType: "event", targetId: eventIds.a, following: false },
      ]);
      const wc = await json(await handleFollowState(request("GET", `/api/v1/me/follows/state?targets=game:${gid.a}&withCount=1`, { cookie: A.cookie })));
      expect(wc.items).toEqual([{ targetType: "game", targetId: gid.a, following: true, count: null }]);
      for (const bad of ["", "game", "game:x", "nope:1", "game:1:2", Array.from({ length: 301 }, (_, i) => `game:${i + 1}`).join(",")]) { // 上限 300（D83 由 100 調高）
        const r = await handleFollowState(request("GET", `/api/v1/me/follows/state?targets=${encodeURIComponent(bad)}`, { cookie: A.cookie }));
        expect(r.status).toBe(400);
      }
      await unfollow(A, "game", gid.a!);
    });

    it("公開人數：低於門檻 null、達門檻回數字、停權不計、可公開快取、目標不存在 404", async () => {
      const ids: number[] = [];
      for (let i = 0; i < 10; i++) {
        const [u] = await getDb().insert(users).values({ email: `fl6-bulk-${i}@example.com`, displayName: `Bulk ${i}` }).returning({ id: users.id });
        ids.push(u!.id);
        extraUserIds.push(u!.id);
      }
      const count = async () => {
        const res = await handleFollowCount(request("GET", `/api/v1/follows/count/game/${gid.g}`), "game", String(gid.g));
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("public, s-maxage=300");
        expect(res.headers.get("set-cookie")).toBeNull();
        return json(res);
      };
      await getDb().insert(follows).values(ids.slice(0, 9).map((userId) => ({ userId, targetType: "game" as const, targetId: gid.g! })));
      expect(await count()).toEqual({ targetType: "game", targetId: gid.g, count: null, minDisplay: 10 });
      await getDb().insert(follows).values({ userId: ids[9]!, targetType: "game", targetId: gid.g! });
      expect((await count()).count).toBe(10);
      await getDb().update(users).set({ suspendedAt: new Date() }).where(eq(users.id, ids[0]!));
      expect((await count()).count).toBeNull(); // 停權不計 → 9
      await getDb().update(users).set({ suspendedAt: null }).where(eq(users.id, ids[0]!));
      process.env.FOLLOW_COUNT_MIN_DISPLAY = "11";
      expect((await count()).count).toBeNull();
      process.env.FOLLOW_COUNT_MIN_DISPLAY = "5";
      expect(await count()).toMatchObject({ count: 10, minDisplay: 5 });
      delete process.env.FOLLOW_COUNT_MIN_DISPLAY;
      const missing = await handleFollowCount(request("GET", "/api/v1/follows/count/game/99999999"), "game", "99999999");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("public, s-maxage=60");
      expect((await handleFollowCount(request("GET", "/x"), "bad", "1")).status).toBe(404);
      await getDb().delete(follows).where(and(eq(follows.targetType, "game"), eq(follows.targetId, gid.g!)));
    });

    it("每晚孤兒清理：指向已不存在目標的列被刪；存在的保留；全部不存在（≥ 安全閥）時不刪", async () => {
      await follow(A, "game", gid.a!);
      const db = getDb();
      await db.insert(follows).values([
        { userId: A.id, targetType: "game", targetId: 98_000_001 },
        { userId: B.id, targetType: "game", targetId: 98_000_001 },
        { userId: A.id, targetType: "event", targetId: 98_000_002 },
        { userId: A.id, targetType: "platform", targetId: 98_000_003 },
        { userId: A.id, targetType: "franchise", targetId: 98_000_004 },
        { userId: A.id, targetType: "company", targetId: 98_000_005 },
      ]);
      const res = await cleanupOrphanFollows({ webhookUrl: undefined });
      expect(res).toEqual({ game: 2, event: 1, platform: 1, franchise: 1, company: 1 });
      const left = await db.select().from(follows).where(eq(follows.userId, A.id));
      expect(left.map((r) => r.targetId)).toEqual([gid.a]);

      // 安全閥：某種類 ≥ 20 個目標全部不存在 → 視為異常，不刪
      const many = Array.from({ length: ORPHAN_SANITY_MIN_TARGETS }, (_, i) => ({ userId: B.id, targetType: "company" as const, targetId: 98_100_000 + i }));
      await db.insert(follows).values(many);
      expect((await cleanupOrphanFollows({ webhookUrl: undefined })).company).toBe(0);
      expect((await db.select().from(follows).where(and(eq(follows.userId, B.id), eq(follows.targetType, "company")))).length).toBe(ORPHAN_SANITY_MIN_TARGETS);
      await db.delete(follows).where(eq(follows.userId, B.id));
      await unfollow(A, "game", gid.a!);
    });
  });

  // ── 熱度訊號與 wSite、/trending、詳情 ───────────────────────────────────
  describe("熱度訊號", () => {
    it("PopularitySignal：site_follows／site_follows_7d 數值；停權不計；7d 只算近 7 天新增", async () => {
      const db = getDb();
      const [s] = await db.insert(users).values({ email: "fl6-susp@example.com", displayName: "Susp", suspendedAt: new Date() }).returning({ id: users.id });
      await db.insert(follows).values([
        { userId: A.id, targetType: "game", targetId: gid.a! },
        { userId: B.id, targetType: "game", targetId: gid.a! },
        { userId: C.id, targetType: "game", targetId: gid.a! },
        { userId: s!.id, targetType: "game", targetId: gid.a! },
        { userId: A.id, targetType: "game", targetId: gid.e! },
        { userId: B.id, targetType: "game", targetId: gid.e! },
        { userId: A.id, targetType: "event", targetId: eventIds.a! }, // 不是遊戲：不計
      ]);
      // C 對 a 的追蹤是 10 天前 → 不在 7d 內
      await db.update(follows).set({ createdAt: at(-10) }).where(and(eq(follows.userId, C.id), eq(follows.targetId, gid.a!)));
      const mineOnly = (rows: Array<{ gameId: number; value: number }>) =>
        Object.fromEntries(rows.filter((r) => gameIds.includes(r.gameId)).map((r) => [r.gameId, r.value]));
      expect(siteFollowsSignal.name).toBe("site_follows");
      expect(siteFollows7dSignal.name).toBe("site_follows_7d");
      expect(mineOnly(await siteFollowsSignal.fetch({}))).toEqual({ [gid.a!]: 3, [gid.e!]: 2 });
      expect(mineOnly(await siteFollows7dSignal.fetch({}))).toEqual({ [gid.a!]: 2, [gid.e!]: 2 });
      expect(await siteFollowsSignal.fetch({ gameIds: [gid.e!] })).toEqual([{ gameId: gid.e, value: 2 }]);
    });

    const source = (): ExternalHypeSource => ({
      fetchHypeVersion: async () => ({ want_to_play: "fl6" }),
      fetchHypeRecords: async () => [{ igdbGameId: 986001, signal: "want_to_play", value: 0.5 }],
    });

    it("refresh-popularity 接入外部訊號：寫入訊號列、wSite = 0.6 × min(1, 總數 ÷ HEAT_COLD_START_FOLLOWS)", async () => {
      const startedAt = new Date();
      const res = await refreshPopularity(source(), { startedAt, log: () => {} }, {
        coldStartFollows: 10,
        scope: "all",
        externalSignals: getCatalogExtensions().popularitySignals,
      });
      expect(res.external.map((e) => e.name).sort()).toEqual(["site_follows", "site_follows_7d"]);
      const rows = (await getDb().execute<{ signal_name: string; game_id: number; value: number }>(
        sql`SELECT signal_name, game_id, value FROM game_popularity_signals WHERE signal_name IN ('site_follows','site_follows_7d') AND game_id = ANY(${`{${gameIds.join(",")}}`}::int[])`,
      )).rows;
      const val = (name: string, key: string) => rows.find((r) => r.signal_name === name && r.game_id === gid[key])?.value;
      expect(val("site_follows", "a")).toBe(3);
      expect(val("site_follows_7d", "e")).toBe(2);
      // 全站總數 ≥ 5（我的遊戲 3 + 2；DB 內若有別人的資料只會更大）→ 5/10 = 0.5 → wSite = 0.3
      expect(res.scores.upcoming?.weights.site).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(res.scores.upcoming?.weights.site).toBeLessThanOrEqual(0.6);
    });

    it("accounts 停用（沒有提供者）：舊的 site_follows／site_follows_7d 被清掉，wSite = 0，與從未有過訊號相同", async () => {
      const res = await refreshPopularity(source(), { startedAt: new Date(), log: () => {} }, { coldStartFollows: 10, scope: "all", externalSignals: [] });
      expect(res.external.map((e) => e.name).sort()).toEqual(["site_follows", "site_follows_7d"]);
      expect(res.external.every((e) => e.write.deleted > 0)).toBe(true);
      expect(res.scores.upcoming?.weights.site).toBe(0);
      expect(res.scores.released?.weights.site).toBe(0);
      const [{ n }] = (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM game_popularity_signals WHERE signal_name IN ('site_follows','site_follows_7d')`)).rows;
      expect(n).toBe(0);
      // 再跑一次：沒有東西可清，不再出現在結果裡
      const again = await refreshPopularity(source(), { startedAt: new Date(), log: () => {} }, { coldStartFollows: 10, scope: "upcoming", externalSignals: [] });
      expect(again.external).toEqual([]);
    });

    async function seed7d(): Promise<void> {
      await getDb().execute(sql`DELETE FROM game_popularity_signals WHERE signal_name IN ('site_follows','site_follows_7d')`);
      // refresh-popularity 的測試已重算過分數：把會用到的分數與等級還原成固定值
      await getDb().execute(sql`
        UPDATE games SET popularity_score = v.s, heat_level = v.h
        FROM (VALUES (${gid.a}::int, 900, 3), (${gid.e}::int, 500, 2), (${gid.g}::int, 100, 1)) AS v(id, s, h) WHERE games.id = v.id`);
      await getDb().execute(sql`
        INSERT INTO game_popularity_signals (game_id, signal_name, value) VALUES
          (${gid.a}, 'site_follows', 12), (${gid.a}, 'site_follows_7d', 5),
          (${gid.e}, 'site_follows', 3), (${gid.e}, 'site_follows_7d', 12)`);
    }
    const mineSlugs = (items: Array<{ slug: string }>) => items.map((i) => i.slug).filter((s) => s.startsWith("fl6-"));

    it("/trending：有 site_follows_7d 提供者時依近 7 日新增追蹤數（同數再依分數）；沒有時依 popularityScore", async () => {
      await seed7d();
      const filter = { platformSlugs: ["fl6-p1", "fl6-p2"] };
      const three = (items: Array<{ slug: string }>) => mineSlugs(items).filter((s) => ["fl6-a", "fl6-e", "fl6-g"].includes(s));
      try {
        setCatalogExtensions({});
        const byScore = await getTrending({ locale: "en", limit: 100, filter });
        expect(byScore.rankedBy).toBe("popularity");
        expect(three(byScore.items)).toEqual(["fl6-a", "fl6-e", "fl6-g"]); // 900、500、100
        setCatalogExtensions({ popularitySignals: [siteFollowsSignal, siteFollows7dSignal] });
        const byFollows = await getTrending({ locale: "en", limit: 100, filter });
        expect(byFollows.rankedBy).toBe("site_follows_7d");
        expect(three(byFollows.items)).toEqual(["fl6-e", "fl6-a", "fl6-g"]); // 12、5、(0 → 分數 100)
        const explicit = await getTrending({ locale: "en", limit: 100, filter, rankBy: "popularity" });
        expect(three(explicit.items)).toEqual(["fl6-a", "fl6-e", "fl6-g"]);
      } finally {
        setCatalogExtensions({ popularitySignals: [siteFollowsSignal, siteFollows7dSignal] });
      }
    });

    it("D83：「上升中」需要 7 日新增 ≥ FOLLOW_RISING_MIN_7D（預設 10）才成立，即使是群內第一名", async () => {
      await seed7d();
      await getDb().execute(sql`UPDATE game_popularity_signals SET value = 9 WHERE game_id = ${gid.e} AND signal_name = 'site_follows_7d'`);
      expect((await getGameDetail({ slug: "fl6-e", locale: "en" }))?.rising).toBe(false); // 第一名，但 9 < 10
      process.env.FOLLOW_RISING_MIN_7D = "9";
      expect((await getGameDetail({ slug: "fl6-e", locale: "en" }))?.rising).toBe(true);
      process.env.FOLLOW_RISING_MIN_7D = "13";
      await getDb().execute(sql`UPDATE game_popularity_signals SET value = 12 WHERE game_id = ${gid.e} AND signal_name = 'site_follows_7d'`);
      expect((await getGameDetail({ slug: "fl6-e", locale: "en" }))?.rising).toBe(false);
      delete process.env.FOLLOW_RISING_MIN_7D;
      expect((await getGameDetail({ slug: "fl6-e", locale: "en" }))?.rising).toBe(true);
      await getDb().execute(sql`DELETE FROM game_popularity_signals WHERE signal_name IN ('site_follows','site_follows_7d')`);
    });

    it("遊戲詳情：followerCount 低於 FOLLOW_COUNT_MIN_DISPLAY 為 null；rising＝7 日前 5%；accounts 停用時皆無", async () => {
      await seed7d();
      const a = await getGameDetail({ slug: "fl6-a", locale: "en" });
      expect(a?.followerCount).toBe(12); // 預設門檻 10
      expect(a?.rising).toBe(false); // 群內有訊號的只有 a、e 兩款：只有第一名 e 在前 5%
      const e = await getGameDetail({ slug: "fl6-e", locale: "en" });
      expect(e?.followerCount).toBeNull(); // 3 < 10
      expect(e?.rising).toBe(true); // 7 日新增 12 ≥ 門檻 10，且是群內第一名（D83）
      process.env.FOLLOW_COUNT_MIN_DISPLAY = "20";
      expect((await getGameDetail({ slug: "fl6-a", locale: "en" }))?.followerCount).toBeNull();
      delete process.env.FOLLOW_COUNT_MIN_DISPLAY;
      setCatalogExtensions({});
      const off = await getGameDetail({ slug: "fl6-a", locale: "en" });
      expect(off?.followerCount).toBeNull();
      expect(off?.rising).toBe(false);
      setCatalogExtensions({ popularitySignals: [siteFollowsSignal, siteFollows7dSignal] });
      await getDb().execute(sql`DELETE FROM game_popularity_signals WHERE signal_name IN ('site_follows','site_follows_7d')`);
    });
  });

  // ── GameFilterProvider 與 me/games ─────────────────────────────────────
  describe("我的遊戲", () => {
    let listA = 0, listB = 0;
    beforeAll(async () => {
      const db = getDb();
      await db.delete(follows).where(inArray(follows.userId, [A.id, B.id, C.id]));
      await db.insert(follows).values([
        { userId: A.id, targetType: "game", targetId: gid.a! },
        { userId: A.id, targetType: "game", targetId: gid.d! },
        { userId: A.id, targetType: "game", targetId: gid.f! },
        { userId: A.id, targetType: "platform", targetId: p2 }, // 只含直接追蹤的遊戲：平台不展開
      ]);
      const l1 = await createList(A.id, { name: "fl6 list", description: null, visibility: "private" });
      const l2 = await createList(B.id, { name: "fl6 other", description: null, visibility: "public" });
      if (!l1.ok || !l2.ok) throw new Error("createList");
      listA = l1.list.id;
      listB = l2.list.id;
      await addToList(A.id, listA, gid.b!, null);
      await addToList(A.id, listA, gid.a!, null);
      await addToList(B.id, listB, gid.g!, null);
      const [acct] = await db.insert(connectedAccounts).values({ userId: A.id, provider: "steam", providerAccountId: "fl6-steam" }).returning({ id: connectedAccounts.id });
      await db.insert(ownedGames).values([
        { connectedAccountId: acct!.id, externalGameId: "1", externalTitle: "Fl6 c", matchedGameId: gid.c!, matchConfidencePct: 100 },
        { connectedAccountId: acct!.id, externalGameId: "2", externalTitle: "unmatched", matchedGameId: null, matchConfidencePct: 0 },
      ]);
    });

    const mine = async (acc: Account, qs: string) => handleMyGames(request("GET", `/api/v1/me/games?${qs}`, { cookie: acc.cookie }));

    it("GameFilterProvider：followed（只含直接追蹤的遊戲）／owned／collected／list:<id>（別人的清單 null）", async () => {
      const { mineGameFilter } = await import("@/modules/accounts/use-cases/catalog-extensions");
      expect(mineGameFilter.dimension).toBe("mine");
      expect(["followed", "owned", "collected", "list:3"].every((v) => mineGameFilter.handles(v))).toBe(true);
      expect(["", "list:", "list:x", "all", "list:0"].some((v) => mineGameFilter.handles(v))).toBe(false);
      expect(sorted(...(await mineGameFilter.resolve(A.id, "followed"))!)).toEqual(sorted(gid.a!, gid.d!, gid.f!));
      expect(await mineGameFilter.resolve(A.id, "owned")).toEqual([gid.c]);
      expect(sorted(...(await mineGameFilter.resolve(A.id, "collected"))!)).toEqual(sorted(gid.a!, gid.b!));
      expect(sorted(...(await mineGameFilter.resolve(A.id, `list:${listA}`))!)).toEqual(sorted(gid.a!, gid.b!));
      expect(await mineGameFilter.resolve(A.id, `list:${listB}`)).toBeNull(); // 別人的清單
      expect(await mineGameFilter.resolve(A.id, "list:99999999")).toBeNull();
      expect(await mineGameFilter.resolve(B.id, "followed")).toEqual([]);
    });

    it("registry 收集已啟用模組的擴充點；accounts 停用時沒有", async () => {
      const { collectCatalogExtensions, enabledModules } = await import("@/modules/registry");
      const on = collectCatalogExtensions(enabledModules({ MODULES: "accounts" }));
      expect(on.popularitySignals.map((s) => s.name)).toEqual(["site_follows", "site_follows_7d"]);
      expect(on.gameFilters.map((f) => f.dimension)).toEqual(["mine"]);
      const off = collectCatalogExtensions(enabledModules({ MODULES: "none" }));
      expect(off).toEqual({ popularitySignals: [], gameFilters: [] });
    });

    it("GET /me/games?mine=followed：遊戲卡片＋最近的上市日（未來最早 → 日期未定 → 過去）；no-store", async () => {
      const res = await mine(A, "mine=followed&locale=en");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await json(res);
      expect(body).toMatchObject({ mine: ["followed"], total: 3, hasMore: false, limit: 24, offset: 0 });
      // a(+10) → f(+30) → d(-60，過去)
      expect(body.items.map((i: J) => i.game.slug)).toEqual(["fl6-a", "fl6-f", "fl6-d"]);
      expect(body.items[0]).toMatchObject({
        game: { id: gid.a, slug: "fl6-a", name: "Fl6 a", originalName: "Fl6 a" },
        nextRelease: { date: day(10), precision: "day", relation: "upcoming", platforms: [{ slug: "fl6-p1", abbreviation: "FP1" }] },
      });
      expect(body.items[2].nextRelease).toMatchObject({ date: day(-60), relation: "past" });
    });

    it("mine 可逗號組合（聯集）、list:<id>、owned；from／to 只留區間內有上市日的；分頁", async () => {
      const union = await json(await mine(A, `mine=followed,list:${listA}`));
      expect(union.items.map((i: J) => i.game.slug)).toEqual(["fl6-a", "fl6-f", "fl6-b", "fl6-d"]);
      expect(union.mine).toEqual(["followed", `list:${listA}`]);
      const owned = await json(await mine(A, "mine=owned"));
      expect(owned.items.map((i: J) => i.game.slug)).toEqual(["fl6-c"]);
      expect(owned.items[0].nextRelease).toMatchObject({ relation: "past", date: day(-10) });
      const ranged = await json(await mine(A, `mine=followed&from=${day(0)}&to=${day(15)}`));
      expect(ranged.items.map((i: J) => i.game.slug)).toEqual(["fl6-a"]);
      expect(ranged.total).toBe(1);
      const p1 = await json(await mine(A, "mine=followed&limit=2"));
      expect(p1.items).toHaveLength(2);
      expect(p1.hasMore).toBe(true);
      const p2 = await json(await mine(A, "mine=followed&limit=2&offset=2"));
      expect(p2.items.map((i: J) => i.game.slug)).toEqual(["fl6-d"]);
      expect(p2.hasMore).toBe(false);
      // 沒有任何遊戲
      const none = await json(await mine(C, "mine=collected"));
      expect(none).toMatchObject({ items: [], total: 0, hasMore: false });
    });

    it("驗證：mine 缺少／不合法 400；別人的清單 404 list_not_found；日期與分頁參數 400", async () => {
      expect(await json(await mine(A, ""))).toEqual({ code: "validation_failed", fields: { mine: "required" } });
      expect(await json(await mine(A, "mine=all"))).toEqual({ code: "validation_failed", fields: { mine: "invalid" } });
      const other = await mine(A, `mine=list:${listB}`);
      expect(other.status).toBe(404);
      expect(await json(other)).toEqual({ code: "list_not_found" });
      expect((await json(await mine(A, "mine=followed&from=2020-13-40"))).fields).toEqual({ from: "invalid" });
      expect((await json(await mine(A, "mine=followed&from=2030-01-02&to=2030-01-01"))).fields).toEqual({ to: "before_from" });
      expect((await json(await mine(A, "mine=followed&limit=500"))).fields).toEqual({ limit: "out_of_range" });
      expect((await mine(A, "mine=followed&offset=-1")).status).toBe(400);
    });
  });

  // ── 私人 iCal ──────────────────────────────────────────────────────────
  describe("私人 iCal", () => {
    let D: Account;
    beforeAll(async () => {
      D = await signUp("fl6-d@example.com");
    });

    it("管理 API：401／403；GET 沒有就建立（冪等，永遠同一個網址）；POST 同；網址格式；預設名稱依語系", async () => {
      expect((await handleFeeds(request("GET", "/api/v1/calendar/feeds"))).status).toBe(401);
      expect((await handleFeeds(request("POST", "/api/v1/calendar/feeds", { cookie: D.cookie, origin: "https://evil.example" }))).status).toBe(403);
      const first = await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: D.cookie }));
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      const f1 = await json(first);
      expect(f1.created).toBe(true);
      expect(f1.feed.url).toMatch(new RegExp(`^${ORIGIN}/ical/u/[A-Za-z0-9_-]{43}\\.ics$`));
      expect(f1.feed.webcalUrl).toBe(f1.feed.url.replace("http:", "webcal:"));
      expect(f1.feed).toMatchObject({
        feedType: "following", locale: "zh-Hant", filterPlatforms: [], filterRegions: [], filterGenres: [], filterStages: [],
        includeReleases: true, includeEvents: true, settingsVersion: 0, lastAccessedAt: null,
      });
      expect(f1.feed.name).toBe("SoK 遊戲日曆：我的追蹤");
      const second = await json(await handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: D.cookie })));
      expect(second.created).toBe(false);
      expect(second.feed.id).toBe(f1.feed.id);
      expect(second.feed.url).toBe(f1.feed.url); // 再次顯示同一網址（P9、D34）
      const post = await handleFeeds(request("POST", "/api/v1/calendar/feeds", { cookie: D.cookie }));
      expect(post.status).toBe(200);
      expect((await json(post)).feed.url).toBe(f1.feed.url);
      expect((await handleFeeds(request("PUT", "/x", { cookie: D.cookie }))).status).toBe(405);
      // 資料庫只存雜湊與密文，不存明文
      const [row] = await getDb().select().from(calendarFeeds).where(eq(calendarFeeds.id, f1.feed.id));
      const token = tokenOf(f1.feed.url);
      expect(row!.tokenHash).toBe(hashFeedToken(token));
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.tokenCiphertext).not.toContain(token);
    });

    it("並發建立：同一個使用者只會有一個有效的 following feed", async () => {
      const E = await signUp("fl6-e@example.com");
      const results = await Promise.all(Array.from({ length: 5 }, () => handleFeeds(request("GET", "/api/v1/calendar/feeds", { cookie: E.cookie }))));
      const bodies = await Promise.all(results.map(json));
      expect(new Set(bodies.map((b) => b.feed.id)).size).toBe(1);
      const rows = await getDb().select().from(calendarFeeds).where(eq(calendarFeeds.userId, E.id));
      expect(rows).toHaveLength(1);
    });

    it("token 錯誤形狀／不存在 → 404 no-store；方法不是 GET/HEAD → 405", async () => {
      for (const file of ["nope.ics", `${"a".repeat(43)}.ics`, `${"a".repeat(43)}`, `${"a".repeat(42)}.ics`, ".ics"]) {
        const res = await handlePrivateIcs(request("GET", `/ical/u/${file}`), file);
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      const token = "b".repeat(43);
      expect((await handlePrivateIcs(request("POST", `/ical/u/${token}.ics`, { cookie: null }), `${token}.ics`)).status).toBe(405);
    });

    it("內容規則：追蹤的遊戲不受 90 天視窗、過去保留 30 天；追蹤的活動＋相關活動；includeEvents／includeReleases；Set-Cookie 沒有", async () => {
      const db = getDb();
      await db.delete(follows).where(eq(follows.userId, D.id));
      await db.insert(follows).values([
        { userId: D.id, targetType: "game", targetId: gid.a! }, // +10
        { userId: D.id, targetType: "game", targetId: gid.b! }, // +200：超過 90 天視窗但追蹤的遊戲不受限
        { userId: D.id, targetType: "game", targetId: gid.c! }, // -10：保留 30 天內
        { userId: D.id, targetType: "game", targetId: gid.d! }, // -60：過期
        { userId: D.id, targetType: "event", targetId: eventIds.a! },
      ]);
      const feed = await getFeed(D);
      const token = tokenOf(feed.url);
      const res = await handlePrivateIcs(request("GET", `/ical/u/${token}.ics`, { cookie: D.cookie }), `${token}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("private, max-age=300");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
      const text = await res.text();
      expect(gameIdsInIcs(text)).toEqual(sorted(gid.a!, gid.b!, gid.c!));
      const parsed = parseIcs(text);
      expect(parsed.calendar.find((p) => p.name === "X-WR-CALNAME")?.value).toBe("SoK 遊戲日曆：我的追蹤");
      const eventUids = parsed.events.map((e) => e.get("UID") ?? "").filter((u) => u.startsWith("event-"));
      // 追蹤的活動 a＋與追蹤的遊戲 a 相關的活動 b；c 只關聯沒追蹤的遊戲 f → 不含
      expect(eventUids.sort()).toEqual([`event-${eventIds.a}@localhost:3000`, `event-${eventIds.b}@localhost:3000`].sort());

      // D83：includeEvents=false → 完全不含活動，包括明確追蹤的活動（上市事件照舊）
      const patch = async (body: unknown) => handleFeed(request("PATCH", `/api/v1/calendar/feeds/${feed.id}`, { cookie: D.cookie, body }), String(feed.id));
      expect((await patch({ includeEvents: false })).status).toBe(200);
      let t = await (await ics(token)).text();
      expect(parseIcs(t).events.map((e) => e.get("UID")).filter((u) => u?.startsWith("event-"))).toEqual([]);
      expect(gameIdsInIcs(t)).toEqual(sorted(gid.a!, gid.b!, gid.c!));
      // includeReleases=false：沒有上市事件
      await patch({ includeEvents: true, includeReleases: false });
      t = await (await ics(token)).text();
      expect(gameIdsInIcs(t)).toEqual([]);
      expect(parseIcs(t).events.length).toBe(2);
      await patch({ includeReleases: true });
    });

    it("追蹤平台／系列／公司：旗下遊戲、90 天視窗、受 ICAL_PUBLIC_MAX_EVENTS 上限（依熱度）、與追蹤的遊戲去重；篩選取交集", async () => {
      const db = getDb();
      const F = await signUp("fl6-f@example.com");
      const feed = await getFeed(F);
      const token = tokenOf(feed.url);
      const patch = async (body: unknown) => handleFeed(request("PATCH", `/api/v1/calendar/feeds/${feed.id}`, { cookie: F.cookie, body }), String(feed.id));
      await db.insert(follows).values({ userId: F.id, targetType: "platform", targetId: p1 });
      let t = await (await ics(token)).text();
      // 平台 p1：視窗內 a(+10)、f(+30)；b(+200)、c(過去)、d 不在 90 天視窗內
      expect(gameIdsInIcs(t)).toEqual(sorted(gid.a!, gid.f!));

      // 上限：只留熱度最高的 1 筆
      process.env.ICAL_PUBLIC_MAX_EVENTS = "1";
      resetCoreEnvCache();
      t = await (await ics(token)).text();
      expect(gameIdsInIcs(t)).toEqual([gid.a]);
      // 追蹤的遊戲不受上限：另外追蹤 f → 上限那 1 筆（a）加上 f
      await db.insert(follows).values({ userId: F.id, targetType: "game", targetId: gid.f! });
      t = await (await ics(token)).text();
      expect(gameIdsInIcs(t)).toEqual(sorted(gid.a!, gid.f!));
      delete process.env.ICAL_PUBLIC_MAX_EVENTS;
      resetCoreEnvCache();

      // 同時追蹤遊戲 f 與平台 p1：f 只出現一次（UID 粒度 遊戲×平台×階段）
      const uids = parseIcs(t).events.map((e) => e.get("UID"));
      expect(new Set(uids).size).toBe(uids.length);

      // 系列與公司：旗下的遊戲 e（平台 p2）
      await db.delete(follows).where(eq(follows.userId, F.id));
      await db.insert(follows).values([
        { userId: F.id, targetType: "franchise", targetId: franchiseId },
      ]);
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([gid.e]);
      await db.delete(follows).where(eq(follows.userId, F.id));
      await db.insert(follows).values({ userId: F.id, targetType: "company", targetId: companyId });
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([gid.e]);

      // 篩選取交集：追蹤平台 p2（e、g），filterPlatforms=[p1] → 交集為空
      await db.delete(follows).where(eq(follows.userId, F.id));
      await db.insert(follows).values({ userId: F.id, targetType: "platform", targetId: p2 });
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual(sorted(gid.e!, gid.g!));
      expect((await patch({ filterPlatforms: [p1] })).status).toBe(200);
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([]);
      expect((await patch({ filterPlatforms: [p2] })).status).toBe(200);
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual(sorted(gid.e!, gid.g!));
      // 篩選 stage：全是 full，只留 early_access → 空
      expect((await patch({ filterPlatforms: [], filterStages: ["early_access"] })).status).toBe(200);
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([]);
    });

    it("D83：filterGenres 依類型過濾上市事件（多個類型＝聯集；PATCH 後 settingsVersion + 1；活動不受類型限制）", async () => {
      const db = getDb();
      const H = await signUp("fl6-genre@example.com");
      const feed = await getFeed(H);
      const token = tokenOf(feed.url);
      const [g1] = await db.insert(genres).values({ igdbId: 986701, name: "Fl6 Genre One", slug: "fl6-genre-one" }).returning({ id: genres.id });
      const [g2] = await db.insert(genres).values({ igdbId: 986702, name: "Fl6 Genre Two", slug: "fl6-genre-two" }).returning({ id: genres.id });
      await db.insert(gameGenres).values([
        { gameId: gid.a!, genreId: g1!.id },
        { gameId: gid.f!, genreId: g2!.id },
      ]);
      await db.insert(follows).values([
        { userId: H.id, targetType: "platform", targetId: p1 }, // 視窗內：a、f
        { userId: H.id, targetType: "event", targetId: eventIds.a! },
      ]);
      const patch = async (body: unknown) => json(await handleFeed(request("PATCH", `/api/v1/calendar/feeds/${feed.id}`, { cookie: H.cookie, body }), String(feed.id)));
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual(sorted(gid.a!, gid.f!));

      const one = await patch({ filterGenres: ["fl6-genre-one"] });
      expect(one.changed).toBe(true);
      expect(one.feed.filterGenres).toEqual(["fl6-genre-one"]);
      expect(one.feed.settingsVersion).toBe(1);
      let t = await (await ics(token)).text();
      expect(gameIdsInIcs(t)).toEqual([gid.a]);
      expect(parseIcs(t).events.map((e) => e.get("UID")).filter((u) => u?.startsWith("event-"))).toEqual([`event-${eventIds.a}@localhost:3000`]); // 活動不受類型限制

      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([gid.a]);
      await patch({ filterGenres: ["fl6-genre-two"] });
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual([gid.f]);
      await patch({ filterGenres: ["fl6-genre-one", "fl6-genre-two"] });
      expect(gameIdsInIcs(await (await ics(token)).text())).toEqual(sorted(gid.a!, gid.f!));
      // 沒變更不加版本；清空＝不限類型
      expect((await patch({ filterGenres: ["fl6-genre-two", "fl6-genre-one"] })).changed).toBe(false);
      await patch({ filterGenres: [] });
      t = await (await ics(token)).text();
      expect(gameIdsInIcs(t)).toEqual(sorted(gid.a!, gid.f!));
    });

    it("ETag／304：資料沒變回 304；設定變更（settingsVersion）、追蹤集合換掉（count 不變）都會換 ETag；PATCH 沒變化不 +1", async () => {
      const db = getDb();
      const G = await signUp("fl6-g@example.com");
      const feed = await getFeed(G);
      const token = tokenOf(feed.url);
      await db.insert(follows).values({ userId: G.id, targetType: "game", targetId: gid.a! });
      const r1 = await ics(token);
      const etag = r1.headers.get("etag")!;
      const r2 = await ics(token, { "if-none-match": etag });
      expect(r2.status).toBe(304);
      expect(r2.headers.get("etag")).toBe(etag);
      expect(r2.headers.get("cache-control")).toBe("private, max-age=300");
      expect(r2.headers.get("set-cookie")).toBeNull();
      expect(await r2.text()).toBe("");
      expect((await ics(token, { "if-none-match": `W/${etag}, "other"` })).status).toBe(304);
      expect((await ics(token, { "if-none-match": '"other"' })).status).toBe(200);

      const patch = async (body: unknown) => json(await handleFeed(request("PATCH", `/api/v1/calendar/feeds/${feed.id}`, { cookie: G.cookie, body }), String(feed.id)));
      const same = await patch({ name: feed.name, includeEvents: true });
      expect(same.changed).toBe(false);
      expect(same.feed.settingsVersion).toBe(0);
      expect((await ics(token, { "if-none-match": etag })).status).toBe(304);
      const renamed = await patch({ name: "My follows" });
      expect(renamed.changed).toBe(true);
      expect(renamed.feed.settingsVersion).toBe(1);
      const r3 = await ics(token, { "if-none-match": etag });
      expect(r3.status).toBe(200);
      const etag3 = r3.headers.get("etag")!;
      expect(etag3).not.toBe(etag);
      expect(parseIcs(await r3.text()).calendar.find((p) => p.name === "X-WR-CALNAME")?.value).toBe("My follows");
      // 語系改變：settingsVersion + 1；名稱已自訂，不被覆寫
      const ja = await patch({ locale: "ja" });
      expect(ja.feed).toMatchObject({ locale: "ja", name: "My follows", settingsVersion: 2 });
      const etag4 = (await ics(token)).headers.get("etag")!;
      expect(etag4).not.toBe(etag3);
      // 追蹤集合換掉（a → f）：筆數相同，ETag 仍然改變
      await db.delete(follows).where(eq(follows.userId, G.id));
      await db.insert(follows).values({ userId: G.id, targetType: "game", targetId: gid.f! });
      expect((await ics(token)).headers.get("etag")).not.toBe(etag4);
      // 語系跟著換預設名稱：名稱還是預設值時
      const H = await signUp("fl6-h@example.com");
      const hf = await getFeed(H);
      const switched = await json(await handleFeed(request("PATCH", `/api/v1/calendar/feeds/${hf.id}`, { cookie: H.cookie, body: { locale: "en" } }), String(hf.id)));
      expect(switched.feed.name).toBe("SoK Game Calendar: My follows");
    });

    it("PATCH 驗證：401／403／404（別人的、不存在、非數字）／400（語系、陣列、型別、空 body）", async () => {
      const feed = await getFeed(D);
      const call = (acc: Account | null, id: string, body: unknown, o: CallOpts = {}) =>
        handleFeed(request("PATCH", `/api/v1/calendar/feeds/${id}`, { cookie: acc?.cookie ?? null, body, ...o }), id);
      expect((await call(null, String(feed.id), { name: "x" })).status).toBe(401);
      expect((await call(D, String(feed.id), { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
      const other = await call(A, String(feed.id), { name: "x" });
      expect(other.status).toBe(404);
      expect(await json(other)).toEqual({ code: "feed_not_found" });
      expect((await call(D, "99999999", { name: "x" })).status).toBe(404);
      expect((await call(D, "abc", { name: "x" })).status).toBe(404);
      const bad = async (body: unknown) => json(await call(D, String(feed.id), body));
      expect(await bad({})).toEqual({ code: "validation_failed", fields: { body: "empty" } });
      expect((await bad({ locale: "xx" })).fields).toEqual({ locale: "invalid" });
      expect((await bad({ name: "" })).fields).toEqual({ name: "required" });
      expect((await bad({ name: "x".repeat(101) })).fields).toEqual({ name: "too_long" });
      expect((await bad({ filterPlatforms: "no" })).fields).toEqual({ filterPlatforms: "invalid" });
      expect((await bad({ filterPlatforms: Array.from({ length: 21 }, (_, i) => i + 1) })).fields).toEqual({ filterPlatforms: "too_many" });
      expect((await bad({ filterPlatforms: [99999999] })).fields).toEqual({ filterPlatforms: "invalid" });
      expect((await bad({ filterRegions: [99999999] })).fields).toEqual({ filterRegions: "invalid" });
      expect((await bad({ filterStages: ["nope"] })).fields).toEqual({ filterStages: "invalid" });
      expect((await bad({ includeEvents: "yes" })).fields).toEqual({ includeEvents: "invalid" });
      const ok = await json(await call(D, String(feed.id), { filterRegions: [wwId], filterGenres: ["rpg"], filterStages: ["full"] }));
      expect(ok.feed).toMatchObject({ filterRegions: [wwId], filterGenres: ["rpg"], filterStages: ["full"] });
      await call(D, String(feed.id), { filterRegions: [], filterGenres: [], filterStages: [] });
    });

    it("rotate：新網址；舊網址 30 天內回空 ics、之後 410；新網址可用；rate limit 每小時 10 次；別人的 404", async () => {
      const db = getDb();
      const H = await signUp("fl6-rot@example.com");
      await db.insert(follows).values({ userId: H.id, targetType: "game", targetId: gid.a! });
      const f1 = await getFeed(H);
      const oldToken = tokenOf(f1.url);
      expect(gameIdsInIcs(await (await ics(oldToken)).text())).toEqual([gid.a]);

      const rotate = (acc: Account | null, id: number, o: CallOpts = {}) =>
        handleFeedRotate(request("POST", `/api/v1/calendar/feeds/${id}/rotate`, { cookie: acc?.cookie ?? null, ...o }), String(id));
      expect((await rotate(null, f1.id)).status).toBe(401);
      expect((await rotate(H, f1.id, { origin: "https://evil.example" })).status).toBe(403);
      expect((await rotate(A, f1.id)).status).toBe(404);
      const res = await rotate(H, f1.id);
      expect(res.status).toBe(200);
      const f2 = (await json(res)).feed;
      expect(f2.id).not.toBe(f1.id);
      const newToken = tokenOf(f2.url);
      expect(newToken).not.toBe(oldToken);
      // 設定沿用
      expect(f2).toMatchObject({ name: f1.name, locale: f1.locale, includeEvents: true, includeReleases: true });
      // GET 現在回新的、同一個
      expect((await getFeed(H)).url).toBe(f2.url);
      // 有效的 following feed 仍只有一個
      const rows = await db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, H.id));
      expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
      expect(rows).toHaveLength(2);

      // 舊網址：30 天內 200 但內容是空的（讓客戶端清掉舊事件）；ETag／304 仍可用
      const empty = await ics(oldToken);
      expect(empty.status).toBe(200);
      expect(empty.headers.get("cache-control")).toBe("private, max-age=300");
      expect(parseIcs(await empty.text()).events).toHaveLength(0);
      expect((await ics(oldToken, { "if-none-match": empty.headers.get("etag")! })).status).toBe(304);
      expect(gameIdsInIcs(await (await ics(newToken)).text())).toEqual([gid.a]);
      // 超過 30 天 → 410
      await db.update(calendarFeeds).set({ revokedAt: at(-31) }).where(eq(calendarFeeds.id, f1.id));
      const gone = await ics(oldToken);
      expect(gone.status).toBe(410);
      expect(gone.headers.get("cache-control")).toBe("no-store");
      await db.update(calendarFeeds).set({ revokedAt: at(-29) }).where(eq(calendarFeeds.id, f1.id));
      expect((await ics(oldToken)).status).toBe(200);
      // 已撤銷的 feed 不能再 PATCH／rotate
      expect((await rotate(H, f1.id)).status).toBe(404);

      // rate limit：建立＋重新產生每小時 10 次（目前 2 列 → 再 rotate 8 次到 10，第 9 次起被擋）
      let current = f2.id as number;
      for (let i = 0; i < 8; i++) {
        const r = await rotate(H, current);
        expect(r.status).toBe(200);
        current = (await json(r)).feed.id;
      }
      const limited = await rotate(H, current);
      expect(limited.status).toBe(429);
      expect(await json(limited)).toEqual({ code: "rate_limited" });
      expect(limited.headers.get("retry-after")).toBe("3600");
      // 一小時前的列不計
      await db.update(calendarFeeds).set({ createdAt: at(-1 / 12) }).where(eq(calendarFeeds.userId, H.id));
      expect((await rotate(H, current)).status).toBe(200);
    });

    it("lastAccessedAt：第一次存取寫入，1 小時內不重寫", async () => {
      const db = getDb();
      const I = await signUp("fl6-acc@example.com");
      const feed = await getFeed(I);
      const token = tokenOf(feed.url);
      const read = async () => (await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)))[0]!.lastAccessedAt;
      expect(await read()).toBeNull();
      await ics(token);
      const t1 = await read();
      expect(t1).not.toBeNull();
      await new Promise((r) => setTimeout(r, 15));
      await ics(token);
      expect((await read())?.getTime()).toBe(t1!.getTime()); // 節流
      await db.update(calendarFeeds).set({ lastAccessedAt: at(-1 / 8) }).where(eq(calendarFeeds.id, feed.id)); // 3 小時前
      await ics(token);
      expect((await read())!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("帳號刪除後 feed 隨 cascade 刪除，網址回 404", async () => {
      const J = await signUp("fl6-del@example.com");
      const token = tokenOf((await getFeed(J)).url);
      expect((await ics(token)).status).toBe(200);
      await getDb().delete(users).where(eq(users.id, J.id));
      expect((await ics(token)).status).toBe(404);
    });
  });
});
