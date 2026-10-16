/**
 * Phase 7 第 5 波整合測試（真實 PG；handler 直接呼叫，不經 HTTP）：
 * 清單 CRUD／可見度／停權／上限／排序、遊玩紀錄驗證與私人筆記、me/games、玩家平均（排程）、手動指定比對。
 * 信箱一律 lp5- 開頭。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { gamePlatforms, games, platforms } from "@/modules/catalog/schema";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { connectedAccounts, gamePlayerRatings, ownedGames, playRecords, userLists, users } from "@/modules/accounts/schema";
import { GET as searchGames } from "@/modules/catalog/api/game-search";
import { addGameToList } from "@/modules/accounts/repository/lists";
import { upsertOwnedGames } from "@/modules/accounts/repository/owned-games";
import { AUTH_BASE_PATH } from "@/modules/accounts/providers/auth";
import {
  accountData as raw,
  handleAuthRequest,
  handleManualMatchRequest,
  handleMatchCandidatesRequest,
  matchOwnedGames,
  resetAuthForTests,
  runRefreshPlayerRatings,
} from "@/modules/accounts/use-cases";

// Route Handler 在請求範圍外呼叫 connection() 會丟錯；這個檔案直接呼叫 handler，所以換成空操作
vi.mock("next/server", () => ({ connection: async () => {} }));

const enabled = !!process.env.TEST_DATABASE_URL;

// route handler 的 ctx（{ params: Promise }）解開後交給 use-cases 的處理函式
type Ctx<K extends string> = { params: Promise<Record<K, string>> };
const api = {
  ...raw,
  handleSharedList: async (r: Request, c: Ctx<"token">) => raw.handleSharedList(r, (await c.params).token),
  handleList: async (r: Request, c: Ctx<"id">) => raw.handleList(r, (await c.params).id),
  handleListGame: async (r: Request, c: Ctx<"id" | "gameId">) => {
    const p = await c.params;
    return raw.handleListGame(r, p.id, p.gameId);
  },
  handleListGamesOrder: async (r: Request, c: Ctx<"id">) => raw.handleListGamesOrder(r, (await c.params).id),
  handlePlayRecord: async (r: Request, c: Ctx<"id">) => raw.handlePlayRecord(r, (await c.params).id),
  handleMyGame: async (r: Request, c: Ctx<"gameId">) => raw.handleMyGame(r, (await c.params).gameId),
  handlePlayerRating: async (r: Request, c: Ctx<"gameId">) => raw.handlePlayerRating(r, (await c.params).gameId),
};
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 9).toString("base64");
const PASSWORD = "a long password 1";
const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES", "STEAM_WEB_API_KEY", "PLAYER_RATING_MIN_COUNT"] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  delete process.env.MODULES;
  delete process.env.STEAM_WEB_API_KEY;
  delete process.env.PLAYER_RATING_MIN_COUNT;
  resetAuthForTests();
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
      body: JSON.stringify({ email, password: PASSWORD, name: "Lp5 Tester" }),
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
}
function request(method: string, path: string, o: CallOpts = {}): Request {
  const headers: Record<string, string> = {};
  if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

/** 回應 JSON 的寬鬆型別（測試只做斷言）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
async function json(res: Response): Promise<J> {
  return res.json();
}

describe.skipIf(!enabled)("accounts 第 5 波：清單、遊玩紀錄、玩家平均、手動比對", () => {
  let A: Account, B: Account, C: Account;
  const gameIds: number[] = [];
  const platformIds: number[] = [];
  let g1 = 0, g2 = 0, g3 = 0, pcId = 0, switchId = 0, otherPlatformId = 0;

  async function insertGame(igdbId: number, slug: string, name: string): Promise<number> {
    const [g] = await getDb().insert(games).values({ igdbId, slug, name, searchText: buildSearchText([name]), firstReleaseDate: "2020-01-01" }).returning({ id: games.id });
    gameIds.push(g!.id);
    return g!.id;
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv();
    g1 = await insertGame(985001, "lp5-hades", "Hades Lp5");
    g2 = await insertGame(985002, "lp5-celeste", "Celeste Lp5");
    g3 = await insertGame(985003, "lp5-tunic", "Tunic Lp5");
    const mk = async (slug: string, kind: "pc" | "console" | "mobile") => {
      const [p] = await getDb().insert(platforms).values({ name: slug, slug, kind }).returning({ id: platforms.id });
      platformIds.push(p!.id);
      return p!.id;
    };
    pcId = await mk("lp5-pc", "pc");
    switchId = await mk("lp5-switch", "console");
    otherPlatformId = await mk("lp5-xbox", "console");
    const mobileId = await mk("lp5-ios", "mobile");
    await getDb().insert(gamePlatforms).values([
      { gameId: g1, platformId: pcId },
      { gameId: g1, platformId: switchId },
      { gameId: g1, platformId: mobileId },
      { gameId: g2, platformId: pcId },
    ]);
    A = await signUp("lp5-a@example.com");
    B = await signUp("lp5-b@example.com");
    C = await signUp("lp5-c@example.com");
  });
  afterAll(async () => {
    await getDb().delete(users).where(like(users.email, "lp5-%"));
    if (gameIds.length) await getDb().delete(games).where(inArray(games.id, gameIds));
    if (platformIds.length) await getDb().delete(platforms).where(inArray(platforms.id, platformIds));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    await closeDb();
  });

  // ── 清單 ────────────────────────────────────────────────────────────────
  describe("清單", () => {
    let privId = 0, pubId = 0, unlId = 0, token = "";

    it("寫入：Origin 不符／缺 → 403（先於 401）；未登入 → 401；讀取未登入 401；全部 no-store", async () => {
      const bad = await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "x" }, origin: "https://evil.example" }));
      expect(bad.status).toBe(403);
      expect((await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "x" }, origin: null }))).status).toBe(403);
      expect((await api.handleLists(request("POST", "/api/v1/lists", { cookie: null, body: { name: "x" }, origin: "https://evil.example" }))).status).toBe(403);
      const anon = await api.handleLists(request("POST", "/api/v1/lists", { body: { name: "x" } }));
      expect(anon.status).toBe(401);
      expect(anon.headers.get("cache-control")).toBe("no-store");
      expect((await api.handleLists(request("GET", "/api/v1/lists"))).status).toBe(401);
      expect((await api.handleLists(request("PUT", "/api/v1/lists", { cookie: A.cookie }))).status).toBe(405);
    });

    it("建立：預設 private、無 shareToken；驗證失敗 400 validation_failed；無效 JSON 400", async () => {
      const res = await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "  想玩  ", description: "d" } }));
      expect(res.status).toBe(201);
      const { list } = await json(res);
      expect(list).toMatchObject({ name: "想玩", description: "d", visibility: "private", shareToken: null, gameCount: 0, sortOrder: 0 });
      privId = list.id;
      const bad = await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "" } }));
      expect(bad.status).toBe(400);
      expect(await json(bad)).toEqual({ code: "validation_failed", fields: { name: "required" } });
      const raw = new Request(`${ORIGIN}/api/v1/lists`, { method: "POST", headers: { origin: ORIGIN, cookie: A.cookie }, body: "{nope" });
      expect(await json(await api.handleLists(raw))).toEqual({ code: "invalid_json" });
    });

    it("預設可見度取 users.defaultListVisibility", async () => {
      await getDb().update(users).set({ defaultListVisibility: "public" }).where(eq(users.id, A.id));
      const { list } = await json(await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "公開預設" } })));
      expect(list.visibility).toBe("public");
      pubId = list.id;
      await getDb().update(users).set({ defaultListVisibility: "private" }).where(eq(users.id, A.id));
      // 明確指定優先
      const un = await json(await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "分享", visibility: "unlisted" } })));
      expect(un.list.visibility).toBe("unlisted");
      expect(un.list.shareToken).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
      unlId = un.list.id;
      token = un.list.shareToken;
    });

    it("改名／描述／可見度：shareToken 只在 unlisted 且只給本人；切離 unlisted 清空，切回來是新的；rotate 換新", async () => {
      const r1 = await json(await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: A.cookie, body: { name: "改名", description: null } }), idCtx(privId)));
      expect(r1.list).toMatchObject({ name: "改名", description: null });
      const toUnl = await json(await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: A.cookie, body: { visibility: "unlisted" } }), idCtx(privId)));
      expect(toUnl.list.shareToken).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
      const first = toUnl.list.shareToken as string;
      const rot = await json(await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: A.cookie, body: { rotateShareToken: true } }), idCtx(privId)));
      expect(rot.list.shareToken).not.toBe(first);
      const back = await json(await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: A.cookie, body: { visibility: "private" } }), idCtx(privId)));
      expect(back.list.shareToken).toBeNull();
      const [row] = await getDb().select().from(userLists).where(eq(userLists.id, privId));
      expect(row!.shareToken).toBeNull();
      // 別人的 / 不存在的
      expect((await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: B.cookie, body: { name: "x" } }), idCtx(privId))).status).toBe(404);
      expect((await api.handleList(request("PATCH", `/api/v1/lists/999999`, { cookie: A.cookie, body: { name: "x" } }), idCtx(999999))).status).toBe(404);
      expect((await api.handleList(request("PATCH", `/api/v1/lists/${privId}`, { cookie: A.cookie, body: {} }), idCtx(privId))).status).toBe(400);
    });

    it("讀取：本人看全部；他人讀 private 404（與不存在同樣）；public 匿名可讀並帶建立者；unlisted 用 id 讀 404、用 token 讀 200", async () => {
      expect((await api.handleList(request("GET", `/api/v1/lists/${privId}`, { cookie: A.cookie }), idCtx(privId))).status).toBe(200);
      const hidden = await api.handleList(request("GET", `/api/v1/lists/${privId}`, { cookie: B.cookie }), idCtx(privId));
      const missing = await api.handleList(request("GET", `/api/v1/lists/999999`, { cookie: B.cookie }), idCtx(999999));
      expect(hidden.status).toBe(404);
      expect(await json(hidden)).toEqual(await json(missing));
      expect((await api.handleList(request("GET", `/api/v1/lists/${privId}`), idCtx(privId))).status).toBe(404);

      const pub = await api.handleList(request("GET", `/api/v1/lists/${pubId}`), idCtx(pubId));
      expect(pub.status).toBe(200);
      expect(pub.headers.get("cache-control")).toBe("no-store");
      const body = await json(pub);
      expect(body.owner).toEqual({ displayName: "Lp5 Tester", handle: null, avatarUrl: null });
      expect(body.isOwner).toBe(false);
      expect(JSON.stringify(body)).not.toContain("lp5-a@example.com");

      expect((await api.handleList(request("GET", `/api/v1/lists/${unlId}`, { cookie: B.cookie }), idCtx(unlId))).status).toBe(404);
      const owner = await json(await api.handleList(request("GET", `/api/v1/lists/${unlId}`, { cookie: A.cookie }), idCtx(unlId)));
      expect(owner.list.shareToken).toBe(token);
      const shared = await api.handleSharedList(request("GET", `/api/v1/lists/shared/${token}`), { params: Promise.resolve({ token }) });
      expect(shared.status).toBe(200);
      const sb = await json(shared);
      expect(sb.list.id).toBe(unlId);
      expect(sb.list.shareToken).toBeNull();
      for (const bad of ["nope", "x".repeat(40), "A".repeat(24)]) {
        expect((await api.handleSharedList(request("GET", `/api/v1/lists/shared/${bad}`), { params: Promise.resolve({ token: bad }) })).status).toBe(404);
      }
      // private／public 清單的 id 不能拿來當 token 讀；private 沒有 token
      const privToken = "Z".repeat(24);
      expect((await api.handleSharedList(request("GET", `/api/v1/lists/shared/${privToken}`), { params: Promise.resolve({ token: privToken }) })).status).toBe(404);
    });

    it("停權者：本人仍可讀寫；他人看不到其 public 與 unlisted（token）清單", async () => {
      await getDb().update(users).set({ suspendedAt: new Date() }).where(eq(users.id, A.id));
      try {
        expect((await api.handleList(request("GET", `/api/v1/lists/${pubId}`, { cookie: B.cookie }), idCtx(pubId))).status).toBe(404);
        expect((await api.handleList(request("GET", `/api/v1/lists/${pubId}`), idCtx(pubId))).status).toBe(404);
        expect((await api.handleSharedList(request("GET", `/api/v1/lists/shared/${token}`), { params: Promise.resolve({ token }) })).status).toBe(404);
        expect((await api.handleList(request("GET", `/api/v1/lists/${pubId}`, { cookie: A.cookie }), idCtx(pubId))).status).toBe(200);
        const w = await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "停權中仍可建立" } }));
        expect(w.status).toBe(201);
      } finally {
        await getDb().update(users).set({ suspendedAt: null }).where(eq(users.id, A.id));
      }
      expect((await api.handleList(request("GET", `/api/v1/lists/${pubId}`, { cookie: B.cookie }), idCtx(pubId))).status).toBe(200);
    });

    const gctx = (id: number, gameId: number | string) => ({ params: Promise.resolve({ id: String(id), gameId: String(gameId) }) });

    it("加入／備註／移除：201→200 冪等、遊戲不存在 404 game_not_found、別人的清單 404；同一遊戲可在多個清單", async () => {
      const add = (listId: number, gameId: number, body?: unknown, who: Account = A) => api.handleListGame(request("POST", `/api/v1/lists/${listId}/games/${gameId}`, { cookie: who.cookie, body }), gctx(listId, gameId));
      const a1 = await add(pubId, g1, { note: "先玩" });
      expect(a1.status).toBe(201);
      expect(await json(a1)).toMatchObject({ created: true, entry: { listId: pubId, gameId: g1, position: 0, note: "先玩" } });
      const again = await add(pubId, g1);
      expect(again.status).toBe(200);
      expect((await json(again)).entry.note).toBe("先玩"); // 省略 note 不改
      expect((await json(await add(pubId, g1, { note: "改了" }))).entry.note).toBe("改了");
      expect((await add(pubId, g2)).status).toBe(201);
      expect((await add(pubId, g3)).status).toBe(201);
      expect(await json(await add(pubId, 999999))).toEqual({ code: "game_not_found" });
      expect((await add(pubId, 999999)).status).toBe(404);
      expect(await json(await add(999999, g1))).toEqual({ code: "list_not_found" });
      expect((await add(pubId, g1, undefined, B)).status).toBe(404);
      expect((await add(unlId, g1)).status).toBe(201); // 多個清單

      const patch = await api.handleListGame(request("PATCH", `/api/v1/lists/${pubId}/games/${g1}`, { cookie: A.cookie, body: { note: null } }), gctx(pubId, g1));
      expect((await json(patch)).entry.note).toBeNull();
      expect((await api.handleListGame(request("PATCH", `/api/v1/lists/${pubId}/games/${g1}`, { cookie: A.cookie, body: {} }), gctx(pubId, g1))).status).toBe(400); // PATCH 必須帶 note
    });

    it("讀清單帶遊戲卡片（slug、名稱、封面、首發日期）與分頁", async () => {
      const d = await json(await api.handleList(request("GET", `/api/v1/lists/${pubId}?limit=2`), idCtx(pubId)));
      expect(d.list.gameCount).toBe(3);
      expect(d.games).toHaveLength(2);
      expect(d.hasMore).toBe(true);
      expect(d.games[0]).toMatchObject({ gameId: g1, position: 0, game: { id: g1, slug: "lp5-hades", name: "Hades Lp5", firstReleaseDate: "2020-01-01", cover: null } });
      const p2 = await json(await api.handleList(request("GET", `/api/v1/lists/${pubId}?limit=2&offset=2`), idCtx(pubId)));
      expect(p2.games.map((x: J) => x.gameId)).toEqual([g3]);
      expect(p2.hasMore).toBe(false);
    });

    it("清單內排序：指定的排前面、其餘維持；不在清單內的 id → 422 order_mismatch；重複 → 400", async () => {
      const order = (body: unknown, who: Account = A) => api.handleListGamesOrder(request("PATCH", `/api/v1/lists/${pubId}/order`, { cookie: who.cookie, body }), idCtx(pubId));
      expect((await order({ gameIds: [g3, g1, g2] })).status).toBe(200);
      const ids = async () => (await json(await api.handleList(request("GET", `/api/v1/lists/${pubId}`, { cookie: A.cookie }), idCtx(pubId)))).games.map((x: J) => x.gameId);
      expect(await ids()).toEqual([g3, g1, g2]);
      expect((await order({ gameIds: [g2] })).status).toBe(200);
      expect(await ids()).toEqual([g2, g3, g1]);
      const mismatch = await order({ gameIds: [g2, 999999] });
      expect(mismatch.status).toBe(422);
      expect(await json(mismatch)).toEqual({ code: "order_mismatch" });
      expect((await order({ gameIds: [g2, g2] })).status).toBe(400);
      expect((await order({ gameIds: [g2] }, B)).status).toBe(404);
    });

    it("移除：本人 200 { removed }；再移除 removed:false；別人 404", async () => {
      const del = (who: Account) => api.handleListGame(request("DELETE", `/api/v1/lists/${unlId}/games/${g1}`, { cookie: who.cookie }), gctx(unlId, g1));
      expect((await del(B)).status).toBe(404);
      expect(await json(await del(A))).toEqual({ ok: true, removed: true });
      expect(await json(await del(A))).toEqual({ ok: true, removed: false });
    });

    it("清單之間排序（PATCH /lists/order）與 GET /lists", async () => {
      const before = (await json(await api.handleLists(request("GET", "/api/v1/lists", { cookie: A.cookie })))).items.map((x: J) => x.id) as number[];
      expect(before.length).toBeGreaterThanOrEqual(4);
      const last = before[before.length - 1]!;
      const res = await api.handleListsOrder(request("PATCH", "/api/v1/lists/order", { cookie: A.cookie, body: { listIds: [last] } }));
      expect(res.status).toBe(200);
      const after = (await json(res)).items.map((x: J) => x.id);
      expect(after[0]).toBe(last);
      expect(after.slice(1)).toEqual(before.slice(0, -1));
      expect((await api.handleListsOrder(request("PATCH", "/api/v1/lists/order", { cookie: A.cookie, body: { listIds: [pubId, 999999] } }))).status).toBe(422);
      // 不能排別人的清單
      const bList = await json(await api.handleLists(request("POST", "/api/v1/lists", { cookie: B.cookie, body: { name: "B 的" } })));
      expect((await api.handleListsOrder(request("PATCH", "/api/v1/lists/order", { cookie: A.cookie, body: { listIds: [bList.list.id] } }))).status).toBe(422);
      expect((await json(await api.handleLists(request("GET", "/api/v1/lists", { cookie: A.cookie })))).items.map((x: J) => x.id)).not.toContain(bList.list.id);
    });

    it("上限：每清單遊戲上限（repository 參數）與每人清單上限 100 → 422", async () => {
      const mini = await json(await api.handleLists(request("POST", "/api/v1/lists", { cookie: B.cookie, body: { name: "迷你" } })));
      const lid = mini.list.id as number;
      expect((await addGameToList(lid, g1, undefined, 2)).kind).toBe("created");
      expect((await addGameToList(lid, g2, undefined, 2)).kind).toBe("created");
      expect((await addGameToList(lid, g3, undefined, 2)).kind).toBe("limit_reached");
      expect((await addGameToList(lid, g1, "已在清單內不受上限", 2)).kind).toBe("exists");

      // C 建到 100 個，第 101 個 422
      for (let i = 0; i < 100; i++) {
        const r = await api.handleLists(request("POST", "/api/v1/lists", { cookie: C.cookie, body: { name: `L${i}` } }));
        expect(r.status).toBe(201);
      }
      const over = await api.handleLists(request("POST", "/api/v1/lists", { cookie: C.cookie, body: { name: "第 101" } }));
      expect(over.status).toBe(422);
      expect(await json(over)).toEqual({ code: "list_limit_reached" });
    });

    it("刪除清單：連帶刪除項目；之後 404；別人不能刪", async () => {
      expect((await api.handleList(request("DELETE", `/api/v1/lists/${pubId}`, { cookie: B.cookie }), idCtx(pubId))).status).toBe(404);
      expect(await json(await api.handleList(request("DELETE", `/api/v1/lists/${pubId}`, { cookie: A.cookie }), idCtx(pubId)))).toEqual({ ok: true });
      expect((await api.handleList(request("GET", `/api/v1/lists/${pubId}`, { cookie: A.cookie }), idCtx(pubId))).status).toBe(404);
    });
  });

  // ── 遊玩紀錄 ─────────────────────────────────────────────────────────────
  describe("遊玩紀錄", () => {
    const create = (body: unknown, who: Account = A) => api.handlePlayRecords(request("POST", "/api/v1/play-records", { cookie: who.cookie, body }));
    let recId = 0;

    it("401／403 Origin", async () => {
      expect((await api.handlePlayRecords(request("GET", "/api/v1/play-records"))).status).toBe(401);
      expect((await create({ gameId: g1, status: "playing" }, { ...A, cookie: "" })).status).toBe(401);
      expect((await api.handlePlayRecords(request("POST", "/api/v1/play-records", { cookie: A.cookie, body: { gameId: g1, status: "playing" }, origin: "https://evil.example" }))).status).toBe(403);
      expect((await api.handlePlayStats(request("GET", "/api/v1/play-records/stats"))).status).toBe(401);
    });

    it("驗證：遊戲不存在 404、平台不屬於該遊戲 400、日期顛倒 400、評分越界 400、耗時為負 400", async () => {
      expect(await json(await create({ gameId: 999999, status: "playing" }))).toEqual({ code: "game_not_found" });
      const bad = await create({ gameId: g1, status: "playing", platformId: otherPlatformId });
      expect(bad.status).toBe(400);
      expect(await json(bad)).toEqual({ code: "validation_failed", fields: { platformId: "not_in_game" } });
      expect(await json(await create({ gameId: g1, status: "playing", platformId: 999999 }))).toEqual({ code: "validation_failed", fields: { platformId: "not_in_game" } });
      expect((await json(await create({ gameId: g1, status: "finished", startedOn: "2026-02-02", finishedOn: "2026-02-01" }))).fields).toEqual({ finishedOn: "before_started_on" });
      expect((await json(await create({ gameId: g1, status: "finished", ratingHalfSteps: 21 }))).fields).toEqual({ ratingHalfSteps: "out_of_range" });
      expect((await json(await create({ gameId: g1, status: "finished", playMinutes: -5 }))).fields).toEqual({ playMinutes: "out_of_range" });
      expect((await json(await create({ gameId: g1 }))).fields).toEqual({ status: "required" });
    });

    it("建立：同一遊戲可多筆；平台屬於遊戲即可；評論可見度預設取 users.defaultReviewVisibility；rating 為 ratingHalfSteps / 2", async () => {
      await getDb().update(users).set({ defaultReviewVisibility: "followers" }).where(eq(users.id, A.id));
      const r1 = await create({ gameId: g1, status: "finished", platformId: pcId, startedOn: "2026-01-01", finishedOn: "2026-01-20", playMinutes: 600, ratingHalfSteps: 17, review: "好玩", reviewHasSpoilers: true, privateNote: "秘密筆記" });
      expect(r1.status).toBe(201);
      const { record } = await json(r1);
      expect(record).toMatchObject({ gameId: g1, platformId: pcId, status: "finished", ratingHalfSteps: 17, rating: 8.5, reviewVisibility: "followers", reviewHasSpoilers: true, privateNote: "秘密筆記", playMinutes: 600 });
      recId = record.id;
      await getDb().update(users).set({ defaultReviewVisibility: "public" }).where(eq(users.id, A.id));
      const r2 = await json(await create({ gameId: g1, status: "playing", platformId: switchId, reviewVisibility: "private" }));
      expect(r2.record.reviewVisibility).toBe("private");
      const r3 = await json(await create({ gameId: g1, status: "want_to_play" }));
      expect(r3.record.reviewVisibility).toBe("public");
    });

    it("GET ?gameId=：只回本人的、含遊戲卡片；別人看不到（含私人筆記）", async () => {
      const mine = await json(await api.handlePlayRecords(request("GET", `/api/v1/play-records?gameId=${g1}`, { cookie: A.cookie })));
      expect(mine.items).toHaveLength(3);
      expect(mine.items[0].game).toMatchObject({ slug: "lp5-hades" });
      const theirs = await api.handlePlayRecords(request("GET", `/api/v1/play-records?gameId=${g1}`, { cookie: B.cookie }));
      expect(await json(theirs)).toMatchObject({ items: [], hasMore: false });
      expect(JSON.stringify(await json(await api.handlePlayRecords(request("GET", "/api/v1/play-records", { cookie: B.cookie }))))).not.toContain("秘密筆記");
      expect((await api.handlePlayRecords(request("GET", "/api/v1/play-records?gameId=abc", { cookie: A.cookie }))).status).toBe(400);
    });

    it("私人筆記不會出現在任何非本人可讀的回應（公開清單、玩家平均、別人的 GET／PATCH／DELETE）", async () => {
      const lst = await json(await api.handleLists(request("POST", "/api/v1/lists", { cookie: A.cookie, body: { name: "公開看看", visibility: "public" } })));
      await api.handleListGame(request("POST", `/api/v1/lists/${lst.list.id}/games/${g1}`, { cookie: A.cookie }), { params: Promise.resolve({ id: String(lst.list.id), gameId: String(g1) }) });
      const seen = [
        await api.handleList(request("GET", `/api/v1/lists/${lst.list.id}`), idCtx(lst.list.id)),
        await api.handlePlayerRating(request("GET", `/api/v1/player-ratings/${g1}`), { params: Promise.resolve({ gameId: String(g1) }) }),
        await api.handlePlayRecord(request("PATCH", `/api/v1/play-records/${recId}`, { cookie: B.cookie, body: { review: "x" } }), idCtx(recId)),
        await api.handlePlayRecord(request("DELETE", `/api/v1/play-records/${recId}`, { cookie: B.cookie }), idCtx(recId)),
        await api.handleMyGame(request("GET", `/api/v1/me/games/${g1}`, { cookie: B.cookie }), { params: Promise.resolve({ gameId: String(g1) }) }),
      ];
      for (const r of seen) expect(JSON.stringify(await json(r))).not.toContain("秘密筆記");
      expect(seen[2]!.status).toBe(404);
      expect(seen[3]!.status).toBe(404);
      const [still] = await getDb().select().from(playRecords).where(eq(playRecords.id, recId));
      expect(still).toBeDefined();
    });

    it("PATCH：部分更新、null 清除、日期與既有值合併檢查、平台驗證、gameId 不可改", async () => {
      const patch = (body: unknown) => api.handlePlayRecord(request("PATCH", `/api/v1/play-records/${recId}`, { cookie: A.cookie, body }), idCtx(recId));
      const ok = await json(await patch({ status: "completed", ratingHalfSteps: 20, privateNote: null }));
      expect(ok.record).toMatchObject({ status: "completed", ratingHalfSteps: 20, rating: 10, privateNote: null, review: "好玩" });
      expect((await json(await patch({ finishedOn: "2025-12-31" }))).fields).toEqual({ finishedOn: "before_started_on" }); // 與既有 startedOn 2026-01-01 合併
      expect((await json(await patch({ startedOn: "2026-03-01" }))).fields).toEqual({ finishedOn: "before_started_on" }); // 既有 finishedOn 2026-01-20
      expect((await json(await patch({ startedOn: null, finishedOn: null }))).record).toMatchObject({ startedOn: null, finishedOn: null });
      expect((await json(await patch({ platformId: otherPlatformId }))).fields).toEqual({ platformId: "not_in_game" });
      expect((await json(await patch({ platformId: null }))).record.platformId).toBeNull();
      expect((await json(await patch({ gameId: g2 }))).fields).toEqual({ gameId: "immutable" });
      expect((await json(await patch({ ratingHalfSteps: 0 }))).fields).toEqual({ ratingHalfSteps: "out_of_range" });
      expect((await api.handlePlayRecord(request("PATCH", "/api/v1/play-records/999999", { cookie: A.cookie, body: { review: "x" } }), idCtx(999999))).status).toBe(404);
    });

    it("stats：各狀態數量（六種都有）、今年完成數（UTC、finishedOn 在今年且 finished／completed）、總耗時", async () => {
      const year = new Date().getUTCFullYear();
      await getDb().insert(playRecords).values([
        { userId: B.id, gameId: g1, status: "finished", finishedOn: `${year}-02-01`, playMinutes: 100 },
        { userId: B.id, gameId: g2, status: "completed", finishedOn: `${year}-03-01`, playMinutes: 50 },
        { userId: B.id, gameId: g3, status: "completed", finishedOn: `${year - 1}-03-01`, playMinutes: 25 },
        { userId: B.id, gameId: g3, status: "finished" },
        { userId: B.id, gameId: g3, status: "abandoned", finishedOn: `${year}-04-01` },
      ]);
      const s = await json(await api.handlePlayStats(request("GET", "/api/v1/play-records/stats", { cookie: B.cookie })));
      expect(s).toEqual({
        byStatus: { want_to_play: 0, playing: 0, finished: 2, completed: 2, paused: 0, abandoned: 1 },
        total: 5,
        finishedThisYear: 2,
        year,
        totalPlayMinutes: 175,
      });
      const empty = await json(await api.handlePlayStats(request("GET", "/api/v1/play-records/stats", { cookie: C.cookie })));
      expect(empty.total).toBe(0);
      expect(empty.byStatus.paused).toBe(0);
    });

    it("me/games：我的所有清單（含 contains 旗標）、這款遊戲的紀錄、平台選項（不含 mobile）；遊戲不存在 404；未登入 401", async () => {
      const gp = (id: number | string) => ({ params: Promise.resolve({ gameId: String(id) }) });
      expect((await api.handleMyGame(request("GET", `/api/v1/me/games/${g1}`), gp(g1))).status).toBe(401);
      expect((await api.handleMyGame(request("GET", `/api/v1/me/games/999999`, { cookie: A.cookie }), gp(999999))).status).toBe(404);
      const res = await api.handleMyGame(request("GET", `/api/v1/me/games/${g1}`, { cookie: A.cookie }), gp(g1));
      expect(res.headers.get("cache-control")).toBe("no-store");
      const s = await json(res);
      expect(s.gameId).toBe(g1);
      expect(s.playRecords).toHaveLength(3);
      expect(s.platforms.map((p: J) => p.slug).sort()).toEqual(["lp5-pc", "lp5-switch"]);
      const flags = new Map<string, boolean>(s.lists.map((l: J) => [l.name, l.contains]));
      expect(flags.get("公開看看")).toBe(true);
      expect(flags.get("分享")).toBe(false); // 已在前面的測試移除
      expect(s.lists.every((l: J) => typeof l.gameCount === "number" && "visibility" in l && "note" in l)).toBe(true);
      const other = await json(await api.handleMyGame(request("GET", `/api/v1/me/games/${g1}`, { cookie: C.cookie }), gp(g1)));
      expect(other.playRecords).toEqual([]);
      expect(other.lists.every((l: J) => l.contains === false)).toBe(true);
    });

    it("刪除：本人 200；別人的 404", async () => {
      const mk = await json(await create({ gameId: g2, status: "paused" }));
      const id = mk.record.id as number;
      expect((await api.handlePlayRecord(request("DELETE", `/api/v1/play-records/${id}`, { cookie: B.cookie }), idCtx(id))).status).toBe(404);
      expect(await json(await api.handlePlayRecord(request("DELETE", `/api/v1/play-records/${id}`, { cookie: A.cookie }), idCtx(id)))).toEqual({ ok: true });
      expect((await api.handlePlayRecord(request("DELETE", `/api/v1/play-records/${id}`, { cookie: A.cookie }), idCtx(id))).status).toBe(404);
    });
  });

  // ── 玩家平均 ─────────────────────────────────────────────────────────────
  describe("玩家平均（refresh_player_ratings）", () => {
    const rating = (gameId: number | string) => api.handlePlayerRating(request("GET", `/api/v1/player-ratings/${gameId}`), { params: Promise.resolve({ gameId: String(gameId) }) });
    const voters: Account[] = [];
    let game = 0;

    it("一人一票（最新一筆有評分）、停權不計、門檻 5 人以下 avg 為 null", async () => {
      game = await insertGame(985010, "lp5-vote", "Vote Lp5");
      for (let i = 0; i < 6; i++) voters.push(await signUp(`lp5-v${i}@example.com`));
      const t = (n: number) => new Date(Date.UTC(2026, 0, n));
      // 每位投 1 票（半分級 16）；voter0 有舊紀錄 4 與較新的 20 → 只算 20；voter1 較新的紀錄沒有評分 → 仍算舊的 16
      for (const v of voters) await getDb().insert(playRecords).values({ userId: v.id, gameId: game, status: "finished", ratingHalfSteps: 16, playMinutes: 600, updatedAt: t(5) });
      await getDb().insert(playRecords).values({ userId: voters[0]!.id, gameId: game, status: "completed", ratingHalfSteps: 4, playMinutes: 100, updatedAt: t(1) }); // 較舊
      await getDb().update(playRecords).set({ ratingHalfSteps: 20, playMinutes: 1000, updatedAt: t(9) }).where(and(eq(playRecords.userId, voters[0]!.id), eq(playRecords.ratingHalfSteps, 16)));
      await getDb().insert(playRecords).values({ userId: voters[1]!.id, gameId: game, status: "playing", ratingHalfSteps: null, playMinutes: 9999, updatedAt: t(20) }); // 較新但沒評分、狀態非玩完

      const r1 = await runRefreshPlayerRatings();
      expect(r1.upserted).toBeGreaterThanOrEqual(1);
      let v = await json(await rating(game));
      // 6 人：5×16 + 1×20 → 平均 (16*5+20)/6=16.667 半分 → 8.333 → 8.3
      expect(v).toEqual({ ratingCount: 6, avg: 8.3, avgPlayMinutes: Math.round((600 * 5 + 1000) / 6) });

      // 停權兩位 → 4 人 < 門檻 5 → avg null；人數仍回報
      await getDb().update(users).set({ suspendedAt: new Date() }).where(inArray(users.id, [voters[2]!.id, voters[3]!.id]));
      await runRefreshPlayerRatings();
      v = await json(await rating(game));
      expect(v.ratingCount).toBe(4);
      expect(v.avg).toBeNull();
      // 解除停權 → 回到 6
      await getDb().update(users).set({ suspendedAt: null }).where(inArray(users.id, [voters[2]!.id, voters[3]!.id]));
      await runRefreshPlayerRatings();
      expect((await json(await rating(game))).ratingCount).toBe(6);

      // 門檻可由 PLAYER_RATING_MIN_COUNT 調整
      process.env.PLAYER_RATING_MIN_COUNT = "7";
      expect((await json(await rating(game))).avg).toBeNull();
      delete process.env.PLAYER_RATING_MIN_COUNT;
      expect((await json(await rating(game))).avg).toBe(8.3);
    });

    it("沒有資料的遊戲回零值；不存在的遊戲 404；可快取的 header（s-maxage=300）且不送 Set-Cookie", async () => {
      const empty = await insertGame(985011, "lp5-empty", "Empty Lp5");
      const none = await rating(empty);
      expect(await json(none)).toEqual({ ratingCount: 0, avg: null, avgPlayMinutes: null });
      const ok = await rating(game);
      expect(ok.headers.get("cache-control")).toBe("public, s-maxage=300");
      expect(ok.headers.get("set-cookie")).toBeNull();
      expect((await rating(999999)).status).toBe(404);
      expect((await rating("abc")).status).toBe(404);
    });

    it("全部評分被刪 → 刪掉彙整列；沒有改變的列不重寫（updated_at 不變）", async () => {
      const [before] = await getDb().select().from(gamePlayerRatings).where(eq(gamePlayerRatings.gameId, game));
      await new Promise((r) => setTimeout(r, 20));
      const again = await runRefreshPlayerRatings();
      const [after] = await getDb().select().from(gamePlayerRatings).where(eq(gamePlayerRatings.gameId, game));
      expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
      expect(again.deleted).toBe(0);
      await getDb().delete(playRecords).where(eq(playRecords.gameId, game));
      const last = await runRefreshPlayerRatings();
      expect(last.deleted).toBeGreaterThanOrEqual(1);
      expect(await getDb().select().from(gamePlayerRatings).where(eq(gamePlayerRatings.gameId, game))).toHaveLength(0);
    });
  });

  // ── 遊戲搜尋（選擇器）────────────────────────────────────────────────────
  describe("GET /api/v1/games/search", () => {
    const search = (qs: string) => searchGames(new Request(`${ORIGIN}/api/v1/games/search${qs}`));
    it("回遊戲迷你卡片；公開可快取；沒帶 q 400；太短回空陣列", async () => {
      const res = await search("?q=Celeste%20Lp5&limit=5");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, s-maxage=60");
      expect(res.headers.get("set-cookie")).toBeNull();
      const { items } = await json(res);
      expect(items[0]).toMatchObject({ id: g2, slug: "lp5-celeste", name: "Celeste Lp5", originalName: "Celeste Lp5", firstReleaseDate: "2020-01-01", cover: null });
      expect((await search("")).status).toBe(400);
      expect(await json(await search("?q=a"))).toEqual({ items: [] });
    });
  });

  // ── 手動指定比對 ─────────────────────────────────────────────────────────
  describe("手動指定比對", () => {
    let accountId = 0;
    let otherAccountId = 0;
    const deferred: (() => Promise<void>)[] = [];
    const deps = { defer: (t: () => Promise<void>) => void deferred.push(t) };
    const rowsOf = async () => (await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, accountId))).sort((a, b) => a.id - b.id);
    const patch = (ownedId: number | string, body: unknown, who: Account | null = A, provider = "steam") =>
      handleManualMatchRequest(request("PATCH", `/api/v1/imports/${provider}/games/${ownedId}`, { cookie: who?.cookie ?? null, body }), provider, String(ownedId), deps);
    let ids: number[] = [];

    beforeAll(async () => {
      const [a] = await getDb().insert(connectedAccounts).values({ userId: A.id, provider: "steam", providerAccountId: "76561198000099001" }).returning({ id: connectedAccounts.id });
      const [o] = await getDb().insert(connectedAccounts).values({ userId: B.id, provider: "steam", providerAccountId: "76561198000099002" }).returning({ id: connectedAccounts.id });
      accountId = a!.id;
      otherAccountId = o!.id;
      await upsertOwnedGames(accountId, [
        { externalGameId: "9001", title: "Zzqx Unknownable One" },
        { externalGameId: "9002", title: "Zzqx Unknownable Two" },
        { externalGameId: "9003", title: "Zzqx Unknownable Three" },
      ], new Date("2026-10-17T00:00:00Z"));
      await upsertOwnedGames(otherAccountId, [{ externalGameId: "9101", title: "Zzqx Other" }], new Date("2026-10-17T00:00:00Z"));
      ids = (await rowsOf()).map((r) => r.id);
      // 三筆都先標成「找不到」（自動）
      await getDb().update(ownedGames).set({ matchConfidencePct: 0 }).where(eq(ownedGames.connectedAccountId, accountId));
    });

    it("401／403／404／409 與驗證", async () => {
      expect((await patch(ids[0]!, { gameId: g1 }, null)).status).toBe(401);
      const evil = await handleManualMatchRequest(request("PATCH", `/api/v1/imports/steam/games/${ids[0]}`, { cookie: A.cookie, body: { gameId: g1 }, origin: "https://evil.example" }), "steam", String(ids[0]), deps);
      expect(evil.status).toBe(403);
      expect((await patch(ids[0]!, { gameId: g1 }, A, "xbox")).status).toBe(404);
      expect((await patch(ids[0]!, { gameId: g1 }, C)).status).toBe(409); // C 沒綁 Steam
      for (const body of [{}, { gameId: "1" }, { gameId: 0 }, { gameId: 1.5 }, { reset: false }, { gameId: g1, reset: true }, [1], "x"]) {
        const r = await patch(ids[0]!, body);
        expect(r.status).toBe(400);
        expect((await json(r)).code).toBe("validation_failed");
      }
      expect(await json(await patch(ids[0]!, { gameId: 999999 }))).toEqual({ code: "game_not_found" });
      expect((await patch(999999, { gameId: g1 })).status).toBe(404);
      expect((await patch("abc", { gameId: g1 })).status).toBe(404);
    });

    it("只能改自己的列：別人的列 id → 404 owned_game_not_found 且不改動", async () => {
      const [theirs] = await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, otherAccountId));
      const r = await patch(theirs!.id, { gameId: g1 });
      expect(r.status).toBe(404);
      expect(await json(r)).toEqual({ code: "owned_game_not_found" });
      const [after] = await getDb().select().from(ownedGames).where(eq(ownedGames.id, theirs!.id));
      expect(after).toMatchObject({ matchedGameId: null, matchMethod: "auto" });
    });

    it("指定：matched、信心 100、manual；回 { item, summary }", async () => {
      const r = await patch(ids[0]!, { gameId: g1 });
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const b = await json(r);
      expect(b.item).toMatchObject({ id: ids[0], status: "matched", confidencePct: 100, matchMethod: "manual", game: { slug: "lp5-hades" } });
      expect(b.summary).toMatchObject({ total: 3, matched: 1, notFound: 2, dismissed: 0 });
      expect((await rowsOf())[0]).toMatchObject({ matchedGameId: g1, matchConfidencePct: 100, matchMethod: "manual" });
    });

    it("否決：dismissed（不是 not_found）、matchedGameId NULL、信心 0、manual；summary 另計", async () => {
      const b = await json(await patch(ids[1]!, { gameId: null }));
      expect(b.item).toMatchObject({ status: "dismissed", confidencePct: 0, matchMethod: "manual", game: null });
      expect(b.summary).toMatchObject({ matched: 1, notFound: 1, dismissed: 1 });
    });

    it("匯入時「找不到重比」不碰 manual 列（否決與指定都保留）；auto 的找不到列仍被重設為 NULL", async () => {
      await upsertOwnedGames(accountId, [{ externalGameId: "9001", title: "Zzqx Unknownable One" }, { externalGameId: "9002", title: "Zzqx Unknownable Two" }, { externalGameId: "9003", title: "Zzqx Unknownable Three" }], new Date("2026-10-18T00:00:00Z"));
      const rows = await rowsOf();
      expect(rows[0]).toMatchObject({ matchedGameId: g1, matchConfidencePct: 100, matchMethod: "manual" });
      expect(rows[1]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "manual" });
      expect(rows[2]).toMatchObject({ matchedGameId: null, matchConfidencePct: null, matchMethod: "auto" });
    });

    it("排程比對不覆寫 manual 列（只處理 pct IS NULL）", async () => {
      const s = await matchOwnedGames({ connectedAccountId: accountId });
      expect(s.processed).toBe(1); // 只有 ids[2]
      const rows = await rowsOf();
      expect(rows[0]).toMatchObject({ matchedGameId: g1, matchConfidencePct: 100, matchMethod: "manual" });
      expect(rows[1]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "manual" });
      expect(rows[2]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "auto" });
    });

    it("重設：回到 auto／NULL 並登記 after 比對；之後比對重跑（找不到→0 auto），重設前的 manual 資訊清除", async () => {
      deferred.length = 0;
      const b = await json(await patch(ids[0]!, { reset: true }));
      expect(b.item).toMatchObject({ status: "queued", confidencePct: null, matchMethod: "auto", game: null });
      expect(deferred).toHaveLength(1);
      await deferred[0]!();
      expect((await rowsOf())[0]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "auto" });
      // 否決也能重設
      const d = await json(await patch(ids[1]!, { reset: true }));
      expect(d.item.status).toBe("queued");
    });

    it("指定的遊戲被刪 → FK SET NULL，狀態變 needs_review（請重新指定），不會被當成否決", async () => {
      const gx = await insertGame(985020, "lp5-doomed", "Doomed Lp5");
      await patch(ids[2]!, { gameId: gx });
      await getDb().delete(games).where(eq(games.id, gx));
      gameIds.splice(gameIds.indexOf(gx), 1);
      const [row] = await getDb().select().from(ownedGames).where(eq(ownedGames.id, ids[2]!));
      expect(row).toMatchObject({ matchedGameId: null, matchConfidencePct: 100, matchMethod: "manual" });
      const page = await json(await api.handlePlayStats(request("GET", "/api/v1/play-records/stats", { cookie: A.cookie }))); // 無關，確認 API 正常
      expect(page.total).toBeGreaterThan(0);
    });

    it("候選：標題候選（遊戲卡片＋信心，高到低）；別人的列 404；未登入 401", async () => {
      await getDb().update(ownedGames).set({ externalTitle: "Hades Lp5" }).where(eq(ownedGames.id, ids[0]!));
      const cand = (ownedId: number | string, who: Account | null = A) =>
        handleMatchCandidatesRequest(request("GET", `/api/v1/imports/steam/games/${ownedId}/candidates`, { cookie: who?.cookie ?? null }), "steam", String(ownedId));
      const res = await cand(ids[0]!);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { items } = await json(res);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].game).toMatchObject({ id: g1, slug: "lp5-hades" });
      expect(items[0].confidencePct).toBeGreaterThanOrEqual(85);
      for (let i = 1; i < items.length; i++) expect(items[i - 1].confidencePct).toBeGreaterThanOrEqual(items[i].confidencePct);
      expect((await cand(ids[0]!, null)).status).toBe(401);
      expect((await cand(ids[0]!, B)).status).toBe(404); // B 有自己的 steam 綁定，但這一列不是他的
    });

    it("候選對別人的列 404", async () => {
      const [theirs] = await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, otherAccountId));
      const r = await handleMatchCandidatesRequest(request("GET", `/api/v1/imports/steam/games/${theirs!.id}/candidates`, { cookie: A.cookie }), "steam", String(theirs!.id));
      expect(r.status).toBe(404);
    });
  });
});
