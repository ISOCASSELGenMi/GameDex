/**
 * Phase 7 第 3 波整合測試（真實 PG、假 Steam 回應；絕不連 Steam）：
 * Steam 登入／綁定 plugin（POST 發起、callbackURL 驗證、註冊開關、暱稱）、匯入端點（401／404／403／409／503／429／422／502）、
 * owned_games upsert 冪等、比對兩步驟、排程批次、cascade。信箱一律 stm7- 開頭。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { externalIds, games } from "@/modules/catalog/schema";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { connectedAccounts, ownedGames, users } from "@/modules/accounts/schema";
import { AUTH_BASE_PATH, STEAM_OP_ENDPOINT } from "@/modules/accounts/providers/auth";
import {
  getOwnedGamesPage,
  handleAuthRequest,
  handleImportRequest,
  importOwnedGames,
  matchOwnedGames,
  resetAuthForTests,
  setSteamFetch,
} from "@/modules/accounts/use-cases";
import { accountsModule } from "@/modules/accounts";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 9).toString("base64");
const PASSWORD = "a long password 1";
const API_KEY = "STEAMKEY-DO-NOT-LEAK-0123456789";
const ID_A = "76561198000007001";
const ID_B = "76561198000007002";
const ID_C = "76561198000007003";
const ID_D = "76561198000007004";
const IMPORT_ID = "76561198000008001";

const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES", "STEAM_WEB_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

// ── 假的 Steam ───────────────────────────────────────────────────────────
let openIdReply = "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n";
let openIdFails = false;
let libraryReply: { status: number; body: unknown } = { status: 200, body: { response: { game_count: 0 } } };
let libraryThrows = false;
const calls: string[] = [];
const fakeSteam: typeof fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.startsWith(STEAM_OP_ENDPOINT)) {
    if (openIdFails) throw new Error("network down");
    return new Response(openIdReply, { status: 200 });
  }
  if (u.includes("GetPlayerSummaries")) {
    const id = new URL(u).searchParams.get("steamids");
    return new Response(JSON.stringify({ response: { players: [{ personaname: `Persona ${id?.slice(-4)}`, avatarfull: "https://avatars.example/a.jpg" }] } }));
  }
  if (u.includes("GetOwnedGames")) {
    if (libraryThrows) throw new Error(`socket hang up ${u}`);
    return new Response(JSON.stringify(libraryReply.body), { status: libraryReply.status });
  }
  return new Response("unexpected " + u, { status: 500 });
};

function setEnv(signup: boolean, apiKey: string | undefined = undefined): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = signup ? "true" : "false";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  delete process.env.MODULES;
  if (apiKey) process.env.STEAM_WEB_API_KEY = apiKey;
  else delete process.env.STEAM_WEB_API_KEY;
  resetAuthForTests();
  setSteamFetch(fakeSteam);
}

const url = (p: string) => `${ORIGIN}${AUTH_BASE_PATH}${p}`;
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => !/=$/.test(c))
    .join("; ");

function req(path: string, init: { body?: unknown; cookie?: string; origin?: string | null } = {}): Request {
  const method = init.body !== undefined ? "POST" : "GET";
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(url(path), { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}

async function signUp(email: string, name = "Stm Tester"): Promise<string> {
  const res = await handleAuthRequest(req("/sign-up/email", { body: { email, password: PASSWORD, name } }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

/** POST /steam/sign-in → { n, state cookie }，可帶 session cookie（綁定）。 */
async function begin(opts: { cookie?: string; callbackURL?: string; errorCallbackURL?: string } = {}): Promise<{ n: string; cookie: string; location: string; res: Response }> {
  const body: Record<string, string> = {};
  if (opts.callbackURL !== undefined) body.callbackURL = opts.callbackURL;
  if (opts.errorCallbackURL !== undefined) body.errorCallbackURL = opts.errorCallbackURL;
  const res = await handleAuthRequest(req("/steam/sign-in", { body, cookie: opts.cookie }));
  expect(res.status).toBe(200);
  const { url: location } = (await res.clone().json()) as { url: string };
  const returnTo = new URL(location).searchParams.get("openid.return_to")!;
  return { n: new URL(returnTo).searchParams.get("n")!, cookie: [opts.cookie, cookieOf(res)].filter(Boolean).join("; "), location, res };
}

function assertion(steamId: string, n: string, over: Record<string, string> = {}): string {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OP_ENDPOINT,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${steamId}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${steamId}`,
    "openid.return_to": `${ORIGIN}${AUTH_BASE_PATH}/steam/callback?n=${n}`,
    "openid.response_nonce": new Date().toISOString().replace(/\.\d+Z$/, "Z") + "abc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2ln",
    n,
    ...over,
  }).toString();
}

const callback = (qs: string, cookie: string) => handleAuthRequest(new Request(url(`/steam/callback?${qs}`), { headers: cookie ? { cookie } : {} }));
const loc = (res: Response) => res.headers.get("location") ?? "";

/** 完整的 Steam 登入（新使用者或既有 SteamID），回傳 session cookie。 */
async function steamLogin(steamId: string): Promise<{ res: Response; cookie: string }> {
  const b = await begin({ callbackURL: "/zh-Hant/account" });
  const res = await callback(assertion(steamId, b.n), b.cookie);
  return { res, cookie: cookieOf(res) };
}

const count = async (table: typeof users | typeof connectedAccounts): Promise<number> => (await getDb().select().from(table)).length;

// ── catalog 測試資料 ─────────────────────────────────────────────────────
async function insertGame(igdbId: number, slug: string, name: string, steamAppId?: string, releaseDate?: string): Promise<number> {
  const [g] = await getDb()
    .insert(games)
    .values({ igdbId, slug, name, searchText: buildSearchText([name]), firstReleaseDate: releaseDate ?? null })
    .returning({ id: games.id });
  if (steamAppId) await getDb().insert(externalIds).values({ gameId: g!.id, source: "steam", externalId: steamAppId, confidencePct: 100 });
  return g!.id;
}

describe.skipIf(!enabled)("accounts 第 3 波：Steam 登入／綁定（plugin）", () => {
  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(true);
  });
  afterAll(async () => {
    await getDb().delete(users).where(like(users.email, "%@steam.placeholder.invalid"));
    await getDb().delete(users).where(like(users.email, "stm7-%"));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    await closeDb();
  });

  it("POST /steam/sign-in：回 { url }（Steam 授權網址，return_to 在 /api/v1/auth/steam/callback），簽章的 state cookie", async () => {
    const b = await begin({ callbackURL: "/zh-Hant/calendar" });
    const u = new URL(b.location);
    expect(u.origin + u.pathname).toBe(STEAM_OP_ENDPOINT);
    expect(u.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(u.searchParams.get("openid.realm")).toBe(ORIGIN);
    expect(u.searchParams.get("openid.return_to")).toBe(`${ORIGIN}${AUTH_BASE_PATH}/steam/callback?n=${b.n}`);
    expect(b.cookie).toMatch(/steam_openid_state=/);
    expect(b.res.headers.get("cache-control") ?? "").not.toMatch(/public/);
  });

  it("GET /steam/sign-in 不存在（發起只能 POST）", async () => {
    const res = await handleAuthRequest(req("/steam/sign-in"));
    expect([404, 405]).toContain(res.status);
  });

  it("POST 的 Origin 不信任（帶 cookie）→ 403；不會寫 state cookie", async () => {
    // Better Auth 在 NODE_ENV=test 預設略過 origin 檢查；這裡明確打開，驗證 plugin 端點確實受它保護（正式環境即是如此）
    const { betterAuth } = await import("better-auth");
    const { buildAuthOptions, createLogMailer, parseAccountsEnv } = await import("@/modules/accounts/providers/auth");
    const { createAuthDatabaseAdapter } = await import("@/modules/accounts/repository/auth-database");
    const opts = buildAuthOptions({ env: parseAccountsEnv(), database: createAuthDatabaseAdapter(), mailer: createLogMailer(), steamFetch: fakeSteam });
    const strict = betterAuth({ ...opts, advanced: { ...opts.advanced, disableOriginCheck: false, disableCSRFCheck: false } });
    const cookie = await signUp("stm7-origin@example.com");
    const headers = (origin: string) => ({ origin, cookie, "content-type": "application/json" });
    const post = (origin: string, body: unknown) => strict.handler(new Request(url("/steam/sign-in"), { method: "POST", headers: headers(origin), body: JSON.stringify(body) }));
    const evil = await post("https://evil.example", {});
    expect(evil.status).toBe(403);
    expect(evil.headers.getSetCookie().join(";")).not.toContain("steam_openid_state");
    expect((await post(ORIGIN, {})).status).toBe(200);
    // callbackURL 指向外站：Better Auth 的檢查也擋下
    expect((await post(ORIGIN, { callbackURL: "https://evil.example/x" })).status).toBe(403);
    expect((await post(ORIGIN, { errorCallbackURL: "//evil.example" })).status).toBe(403);
  });

  it("callback 成功：新 user（placeholder 信箱、emailVerified=false）＋ steam 連結帳號 ＋ session；check_authentication 有送出；沒有 API key 時名稱是 Steam <id>", async () => {
    calls.length = 0;
    const b = await begin({ callbackURL: "/zh-Hant/account" });
    const res = await callback(assertion(ID_A, b.n), b.cookie);
    expect(res.status).toBe(302);
    expect(loc(res)).toBe("/zh-Hant/account");
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);
    expect(calls.some((c) => c.startsWith(STEAM_OP_ENDPOINT))).toBe(true);
    expect(calls.some((c) => c.includes("GetPlayerSummaries"))).toBe(false);
    const [u] = await getDb().select().from(users).where(eq(users.email, `${ID_A}@steam.placeholder.invalid`));
    expect(u).toMatchObject({ displayName: `Steam ${ID_A}`, emailVerified: false });
    const accts = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u!.id));
    expect(accts.map((a) => [a.provider, a.providerAccountId, a.password])).toEqual([["steam", ID_A, null]]);
  });

  it("同一個 SteamID 再登入 → 同一個 user，不新增；已綁定者不打 GetPlayerSummaries", async () => {
    const before = await count(users);
    const { res } = await steamLogin(ID_A);
    expect(loc(res)).toBe("/zh-Hant/account");
    expect(await count(users)).toBe(before);
  });

  it("有 STEAM_WEB_API_KEY：新使用者用 GetPlayerSummaries 的暱稱與頭像；失敗不擋登入", async () => {
    setEnv(true, API_KEY);
    try {
      const { res } = await steamLogin(ID_B);
      expect(loc(res)).toBe("/zh-Hant/account");
      const [u] = await getDb().select().from(users).where(eq(users.email, `${ID_B}@steam.placeholder.invalid`));
      expect(u).toMatchObject({ displayName: "Persona 7002", avatarUrl: "https://avatars.example/a.jpg" });
      // Web API 壞掉（回 500）→ 仍可登入，用預設名稱
      const broken: typeof fetch = async (u2, init) => (String(u2).includes("GetPlayerSummaries") ? new Response("x", { status: 500 }) : fakeSteam(u2, init));
      setSteamFetch(broken);
      const r2 = await steamLogin(ID_C);
      expect(loc(r2.res)).toBe("/zh-Hant/account");
      const [u2] = await getDb().select().from(users).where(eq(users.email, `${ID_C}@steam.placeholder.invalid`));
      expect(u2!.displayName).toBe(`Steam ${ID_C}`);
    } finally {
      setEnv(true);
    }
  });

  const forged: [string, Record<string, string>][] = [
    ["claimed_id 網域不對", { "openid.claimed_id": "https://evil.example/openid/id/76561198000009999", "openid.identity": "https://evil.example/openid/id/76561198000009999" }],
    ["identity 不等於 claimed_id", { "openid.identity": "https://steamcommunity.com/openid/id/76561198000009999" }],
    ["op_endpoint 被換", { "openid.op_endpoint": "https://evil.example/openid/login" }],
    ["return_to 被換", { "openid.return_to": `${ORIGIN}/other` }],
    ["nonce 過期", { "openid.response_nonce": "2020-01-01T00:00:00Zxyz" }],
    ["mode 不是 id_res", { "openid.mode": "cancel" }],
  ];
  for (const [title, over] of forged) {
    it(`拒絕偽造：${title} → ?error=steam_invalid_response，不建 user`, async () => {
      const before = await count(users);
      const b = await begin({ callbackURL: "/zh-Hant/account", errorCallbackURL: "/zh-Hant/login" });
      const res = await callback(assertion(ID_D, b.n, over), b.cookie);
      expect(loc(res)).toBe("/zh-Hant/login?error=steam_invalid_response");
      expect(await count(users)).toBe(before);
      expect(res.headers.getSetCookie().join(";")).not.toContain("session_token");
    });
  }

  it("拒絕：Steam 回 is_valid:false → steam_verification_failed；網路錯誤 → steam_network_error", async () => {
    const before = await count(users);
    openIdReply = "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n";
    let b = await begin({ errorCallbackURL: "/zh-Hant/login" });
    expect(loc(await callback(assertion(ID_D, b.n), b.cookie))).toBe("/zh-Hant/login?error=steam_verification_failed");
    openIdReply = "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n";
    openIdFails = true;
    b = await begin({ errorCallbackURL: "/zh-Hant/login" });
    expect(loc(await callback(assertion(ID_D, b.n), b.cookie))).toBe("/zh-Hant/login?error=steam_network_error");
    openIdFails = false;
    expect(await count(users)).toBe(before);
  });

  it("拒絕：沒有 state cookie、n 不符、state 只能用一次", async () => {
    const b = await begin({ errorCallbackURL: "/zh-Hant/login" });
    expect(loc(await callback(assertion(ID_D, b.n), ""))).toBe("/zh-Hant/account?error=steam_invalid_response");
    expect(loc(await callback(assertion(ID_D, "zzz"), b.cookie))).toBe("/zh-Hant/login?error=steam_invalid_response");
    // 成功後回應會清掉 state cookie（一次性）
    const ok = await callback(assertion(ID_A, b.n), b.cookie);
    expect(ok.headers.getSetCookie().some((c) => c.startsWith("better-auth.steam_openid_state=;") || /steam_openid_state=;/.test(c) || /steam_openid_state=[^;]*;.*Max-Age=0/i.test(c))).toBe(true);
  });

  it("callbackURL／errorCallbackURL 只接受站內相對路徑：外站、//evil、含 scheme 都退回預設 /zh-Hant/account", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/\\evil.example"]) {
      const res = await handleAuthRequest(req("/steam/sign-in", { body: { callbackURL: bad, errorCallbackURL: bad } }));
      if (res.status !== 200) {
        // Better Auth 的 origin 檢查先擋下（403）也算拒絕
        expect(res.status, bad).toBe(403);
        continue;
      }
      const cookie = cookieOf(res);
      const n = new URL(new URL(((await res.json()) as { url: string }).url).searchParams.get("openid.return_to")!).searchParams.get("n")!;
      const ok = await callback(assertion(ID_A, n), cookie);
      expect(loc(ok), bad).toBe("/zh-Hant/account");
      const b2 = await begin({ callbackURL: bad, errorCallbackURL: bad }).catch(() => null);
      if (b2) expect(loc(await callback(assertion(ID_D, b2.n, { "openid.mode": "cancel" }), b2.cookie)), bad).toBe("/zh-Hant/account?error=steam_invalid_response");
    }
  });

  it("綁定：已登入的 Email 帳號可綁 Steam（不登入成別人）；已被別人綁走的 SteamID 不能再綁 → steam_already_linked", async () => {
    const cookie = await signUp("stm7-link@example.com");
    const b = await begin({ cookie, callbackURL: "/zh-Hant/account", errorCallbackURL: "/zh-Hant/account" });
    const res = await callback(assertion(ID_D, b.n), b.cookie);
    expect(loc(res)).toBe("/zh-Hant/account");
    const [u] = await getDb().select().from(users).where(eq(users.email, "stm7-link@example.com"));
    const accts = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u!.id));
    expect(accts.map((a) => a.provider).sort()).toEqual(["credential", "steam"]);
    // ID_A 屬於另一個使用者
    const b2 = await begin({ cookie, errorCallbackURL: "/zh-Hant/account" });
    expect(loc(await callback(assertion(ID_A, b2.n), b2.cookie))).toBe("/zh-Hant/account?error=steam_already_linked");
    // 重複綁自己的 SteamID 不會出錯、不重複建列
    const b3 = await begin({ cookie });
    expect(loc(await callback(assertion(ID_D, b3.n), b3.cookie))).toBe("/zh-Hant/account");
    expect((await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u!.id))).length).toBe(2);
  });

  it("註冊關閉：沒有對應帳號的新 SteamID → signup_disabled（不建 user）；已綁定的 SteamID 照常登入；已登入者綁定不受影響", async () => {
    setEnv(false);
    try {
      const NEW_ID = "76561198000007999";
      const before = await count(users);
      const b = await begin({ errorCallbackURL: "/zh-Hant/login" });
      const res = await callback(assertion(NEW_ID, b.n), b.cookie);
      expect(loc(res)).toBe("/zh-Hant/login?error=signup_disabled");
      expect(await count(users)).toBe(before);
      expect(res.headers.getSetCookie().join(";")).not.toContain("session_token");

      const existing = await steamLogin(ID_A);
      expect(loc(existing.res)).toBe("/zh-Hant/account");
      expect(existing.res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);

      // 既有 Email 帳號（註冊關閉前建立）登入後綁 Steam 不受影響
      setEnv(true);
      await signUp("stm7-closed-link@example.com");
      setEnv(false);
      const login = await handleAuthRequest(req("/sign-in/email", { body: { email: "stm7-closed-link@example.com", password: PASSWORD } }));
      expect(login.status).toBe(200);
      const lb = await begin({ cookie: cookieOf(login) });
      expect(loc(await callback(assertion(NEW_ID, lb.n), lb.cookie))).toBe("/zh-Hant/account");
    } finally {
      setEnv(true);
    }
  });

  it("/steam/* 限流：每分鐘 20 次（plugin 規則已註冊）", async () => {
    const { createAuth, createLogMailer } = await import("@/modules/accounts/providers/auth");
    const { createAuthDatabaseAdapter } = await import("@/modules/accounts/repository/auth-database");
    const { parseAccountsEnv } = await import("@/modules/accounts/providers/auth");
    const auth = createAuth({ env: parseAccountsEnv(), database: createAuthDatabaseAdapter(), mailer: createLogMailer(), rateLimitEnabled: true });
    const rules = (auth.options.plugins ?? []).flatMap((p) => ("rateLimit" in p ? (p.rateLimit as { max: number; window: number; pathMatcher: (p: string) => boolean }[]) : []));
    expect(rules.some((r) => r.max === 20 && r.window === 60 && r.pathMatcher("/steam/sign-in") && r.pathMatcher("/steam/callback"))).toBe(true);
  });
});

describe.skipIf(!enabled)("accounts 第 3 波：遊戲庫匯入與比對", () => {
  const gameIds: number[] = [];
  let cookie = "";
  let accountId = 0;
  let userId = 0;
  const deferred: (() => Promise<void>)[] = [];
  const deps = (now?: Date) => ({ defer: (t: () => Promise<void>) => void deferred.push(t), fetch: fakeSteam, now });
  const post = (cookieHeader: string | null, origin: string | null = ORIGIN) =>
    new Request(`${ORIGIN}/api/v1/imports/steam`, { method: "POST", headers: { ...(origin ? { origin } : {}), ...(cookieHeader ? { cookie: cookieHeader } : {}) } });
  const get = (cookieHeader: string | null, qs = "") =>
    new Request(`${ORIGIN}/api/v1/imports/steam${qs}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
  const owned = async () => getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, accountId));
  const T0 = new Date("2026-10-17T00:00:00Z");

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(true, API_KEY);
    // 目錄：AppID 命中、標題自動採用、待確認（子集）、候選競爭
    gameIds.push(await insertGame(970001, "stm7-hades", "Hades", "1145360", "2020-09-17"));
    gameIds.push(await insertGame(970002, "stm7-halo-wars-2", "Halo Wars 2"));
    gameIds.push(await insertGame(970003, "stm7-stardew-valley", "Stardew Valley"));
    // 一位已登入、綁定 Steam 的使用者（走真正的 plugin 流程）
    cookie = await signUp("stm7-import@example.com");
    const b = await begin({ cookie, errorCallbackURL: "/zh-Hant/account" });
    await callback(assertion(IMPORT_ID, b.n), b.cookie);
    const [u] = await getDb().select().from(users).where(eq(users.email, "stm7-import@example.com"));
    userId = u!.id;
    const steamRow = (await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, userId))).find((x) => x.provider === "steam");
    accountId = steamRow!.id;
  });
  afterAll(async () => {
    await getDb().delete(users).where(like(users.email, "stm7-%"));
    await getDb().delete(users).where(like(users.email, "%@steam.placeholder.invalid"));
    if (gameIds.length) await getDb().delete(games).where(inArray(games.id, gameIds));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAuthForTests();
    await closeDb();
  });

  it("路由：不支援的 provider 404；Origin 不符 403；未登入 401；未綁 Steam 409", async () => {
    expect((await handleImportRequest(post(cookie), "xbox", deps())).status).toBe(404);
    expect((await handleImportRequest(post(cookie, "https://evil.example"), "steam", deps())).status).toBe(403);
    expect((await handleImportRequest(post(cookie, null), "steam", deps())).status).toBe(403);
    expect((await handleImportRequest(post(null), "steam", deps())).status).toBe(401);
    const noSteam = await signUp("stm7-nosteam@example.com");
    const res = await handleImportRequest(post(noSteam), "steam", deps());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "steam_not_linked" });
    expect((await handleImportRequest(get(noSteam), "steam", deps())).status).toBe(409);
    expect((await handleImportRequest(get(null), "steam", deps())).status).toBe(401);
    for (const r of [await handleImportRequest(post(null), "steam", deps()), res]) expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("沒設 STEAM_WEB_API_KEY → 503 steam_import_unavailable（不呼叫 Steam）；GET 的 importAvailable=false", async () => {
    setEnv(true);
    calls.length = 0;
    const res = await handleImportRequest(post(cookie), "steam", deps());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "steam_import_unavailable" });
    expect(calls).toHaveLength(0);
    const g = await handleImportRequest(get(cookie), "steam", deps());
    expect((await g.json()).importAvailable).toBe(false);
    setEnv(true, API_KEY);
  });

  it("個人檔案非公開 → 422 steam_profile_private；金鑰被拒 → 503；5xx／網路錯誤 → 502；回應與 log 不含 API key", async () => {
    const check = async (setup: () => void, status: number, code: string) => {
      setup();
      const res = await handleImportRequest(post(cookie), "steam", deps(new Date(T0.getTime() - 86400_000)));
      const text = await res.text();
      expect(res.status).toBe(status);
      expect(JSON.parse(text)).toEqual({ code });
      expect(text).not.toContain(API_KEY);
    };
    await check(() => (libraryReply = { status: 200, body: { response: {} } }), 422, "steam_profile_private");
    await check(() => (libraryReply = { status: 403, body: {} }), 503, "steam_import_unavailable");
    await check(() => (libraryReply = { status: 500, body: {} }), 502, "steam_upstream_error");
    libraryThrows = true;
    await check(() => undefined, 502, "steam_upstream_error");
    libraryThrows = false;
    expect(await owned()).toHaveLength(0);
  });

  it("匯入成功：202 { imported, total }，列為未比對（NULL）；after 任務被登記但請求內沒有比對", async () => {
    libraryReply = {
      status: 200,
      body: {
        response: {
          game_count: 5,
          games: [
            { appid: 1145360, name: "Hades" }, // AppID 命中
            { appid: 413150, name: "Stardew Valley™" }, // 標題自動採用
            { appid: 555001, name: "Halo Wars" }, // 子集 → 待確認
            { appid: 555002, name: "Zzqx Unknownable Fqwerty Title" }, // 找不到
            { appid: 555003, name: "Another Obscure Qwxz Game" },
          ],
        },
      },
    };
    deferred.length = 0;
    const res = await handleImportRequest(post(cookie), "steam", deps(T0));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ imported: 5, total: 5 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const rows = await owned();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.matchedGameId === null && r.matchConfidencePct === null)).toBe(true);
    expect(deferred).toHaveLength(1);
  });

  it("冷卻：10 分鐘內再匯入 → 429 import_cooldown（含 Retry-After）；過了冷卻可再匯入，upsert 冪等且保留比對結果", async () => {
    const soon = await handleImportRequest(post(cookie), "steam", deps(new Date(T0.getTime() + 5 * 60_000)));
    expect(soon.status).toBe(429);
    expect(await soon.json()).toEqual({ code: "import_cooldown" });
    expect(Number(soon.headers.get("retry-after"))).toBeGreaterThan(0);
    const g = await (await handleImportRequest(get(cookie), "steam", deps(new Date(T0.getTime() + 5 * 60_000)))).json();
    expect(g.cooldownSec).toBeGreaterThan(0);
    expect(g.importAvailable).toBe(true);

    // 先跑 after 任務（比對），再於冷卻後重新匯入
    for (const t of deferred.splice(0)) await t();
    const matchedBefore = (await owned()).map((r) => [r.externalGameId, r.matchedGameId, r.matchConfidencePct]).sort();
    const later = new Date(T0.getTime() + 11 * 60_000);
    const again = await handleImportRequest(post(cookie), "steam", deps(later));
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ imported: 5, total: 5 });
    const rows = await owned();
    expect(rows).toHaveLength(5);
    // matched／needs_review 保留；not_found（信心 0）被重設為未比對（NULL）
    const expectedAfter = matchedBefore.map(([id, gid, pct]) => (gid === null && pct === 0 ? [id, null, null] : [id, gid, pct])).sort();
    expect(rows.map((r) => [r.externalGameId, r.matchedGameId, r.matchConfidencePct]).sort()).toEqual(expectedAfter);
    expect(rows.every((r) => r.importedAt.getTime() === later.getTime())).toBe(true);
    for (const t of deferred.splice(0)) await t(); // 重新比對 → 回到原本結果
    expect((await owned()).map((r) => [r.externalGameId, r.matchedGameId, r.matchConfidencePct]).sort()).toEqual(matchedBefore);
    // Steam 回應裡消失的遊戲先保留
    libraryReply = { status: 200, body: { response: { game_count: 1, games: [{ appid: 1145360, name: "Hades" }] } } };
    const third = await handleImportRequest(post(cookie), "steam", deps(new Date(later.getTime() + 11 * 60_000)));
    expect(await third.json()).toEqual({ imported: 1, total: 5 });
    for (const t of deferred.splice(0)) await t();
  });

  it("比對兩步驟：AppID 命中 100／標題自動採用／子集待確認（不採用）／找不到 0；之後 GET 清單的狀態與遊戲連結", async () => {
    const by = Object.fromEntries((await owned()).map((r) => [r.externalGameId, r]));
    // after() 的比對已經跑過（上一個測試）
    expect(by["1145360"]).toMatchObject({ matchedGameId: gameIds[0], matchConfidencePct: 100 });
    expect(by["413150"]).toMatchObject({ matchedGameId: gameIds[2] });
    expect(by["413150"]!.matchConfidencePct).toBeGreaterThanOrEqual(85);
    expect(by["555001"]!.matchedGameId).toBeNull();
    expect(by["555001"]!.matchConfidencePct).toBeGreaterThanOrEqual(60);
    expect(by["555001"]!.matchConfidencePct).toBeLessThan(85);
    expect(by["555002"]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0 });
    expect(by["555003"]).toMatchObject({ matchedGameId: null, matchConfidencePct: 0 });

    const page = await (await handleImportRequest(get(cookie), "steam", deps())).json();
    expect(page.summary).toMatchObject({ total: 5, matched: 2, needsReview: 1, notFound: 2, queued: 0 });
    const hades = page.items.find((i: { externalGameId: string }) => i.externalGameId === "1145360");
    expect(hades).toMatchObject({ status: "matched", confidencePct: 100, game: { slug: "stm7-hades", name: "Hades" } });
    expect(page.items.find((i: { externalGameId: string }) => i.externalGameId === "555001")).toMatchObject({ status: "needs_review", game: null });
    expect(page.items.find((i: { externalGameId: string }) => i.externalGameId === "555002")).toMatchObject({ status: "not_found", game: null });
    expect(page.hasMore).toBe(false);
    // 分頁
    const p1 = await (await handleImportRequest(get(cookie, "?limit=2&offset=0"), "steam", deps())).json();
    const p2 = await (await handleImportRequest(get(cookie, "?limit=2&offset=2"), "steam", deps())).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i: { id: number }) => i.id)).size).toBe(4);
  });

  it("再匯入重比「找不到」：not_found → queued；needs_review、matched 不動；他人的 not_found 不受影響；catalog 新增對應遊戲後比對成 matched", async () => {
    // 他人的 not_found 列
    const otherCookie = await signUp("stm7-other-nf@example.com");
    const ob = await begin({ cookie: otherCookie });
    await callback(assertion("76561198000008002", ob.n), ob.cookie);
    const [ou] = await getDb().select().from(users).where(eq(users.email, "stm7-other-nf@example.com"));
    const [oacct] = (await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, ou!.id))).filter((x) => x.provider === "steam");
    const [otherRow] = await getDb()
      .insert(ownedGames)
      .values({ connectedAccountId: oacct!.id, externalGameId: "555002", externalTitle: "Zzqx Unknownable Fqwerty Title", matchConfidencePct: 0 })
      .returning();

    const snapshot = async () => Object.fromEntries((await owned()).map((r) => [r.externalGameId, [r.matchedGameId, r.matchConfidencePct]]));
    const before = await snapshot();
    expect(before["555002"]).toEqual([null, 0]);
    expect(before["555001"]![1]).toBeGreaterThan(0);

    libraryReply = {
      status: 200,
      body: { response: { game_count: 1, games: [{ appid: 1145360, name: "Hades" }] } },
    };
    const t1 = new Date(T0.getTime() + 60 * 60_000);
    deferred.length = 0;
    const res = await handleImportRequest(post(cookie), "steam", deps(t1));
    expect(res.status).toBe(202);
    const mid = await snapshot();
    expect(mid["555002"]).toEqual([null, null]); // queued
    expect(mid["555003"]).toEqual([null, null]);
    expect(mid["555001"]).toEqual(before["555001"]); // needs_review 不動
    expect(mid["1145360"]).toEqual(before["1145360"]); // matched 不動
    const [otherAfter] = await getDb().select().from(ownedGames).where(eq(ownedGames.id, otherRow!.id));
    expect(otherAfter).toMatchObject({ matchedGameId: null, matchConfidencePct: 0 }); // 他人不受影響

    // catalog 之後新增對應遊戲 → 再匯入（越過冷卻）＋比對 → matched
    const newGame = await insertGame(970021, "stm7-zzqx", "Zzqx Unknownable Fqwerty Title");
    gameIds.push(newGame);
    const t2 = new Date(t1.getTime() + 11 * 60_000);
    expect((await handleImportRequest(post(cookie), "steam", deps(t2))).status).toBe(202);
    for (const t of deferred.splice(0)) await t();
    const end = await snapshot();
    expect(end["555002"]![0]).toBe(newGame);
    expect(end["555002"]![1]).toBeGreaterThanOrEqual(85);
    expect(end["555003"]).toEqual([null, 0]); // 仍找不到
    expect(end["555001"]).toEqual(before["555001"]);
  });

  it("排程批次：只處理 matchConfidencePct IS NULL 的列，單次不超過上限；已比對的不重比", async () => {
    await getDb().insert(ownedGames).values([
      { connectedAccountId: accountId, externalGameId: "900001", externalTitle: "Stardew Valley" },
      { connectedAccountId: accountId, externalGameId: "900002", externalTitle: "Qzxv Nonexistent One" },
      { connectedAccountId: accountId, externalGameId: "900003", externalTitle: "Qzxv Nonexistent Two" },
    ]);
    const before = (await owned()).filter((r) => r.matchConfidencePct !== null).map((r) => [r.id, r.matchedGameId, r.matchConfidencePct]);
    const first = await matchOwnedGames({ limit: 2 });
    expect(first.processed).toBe(2);
    const second = await matchOwnedGames({ limit: 2 });
    expect(second.processed).toBe(1);
    expect((await matchOwnedGames({})).processed).toBe(0);
    const rows = await owned();
    expect(rows.find((r) => r.externalGameId === "900001")).toMatchObject({ matchedGameId: gameIds[2] });
    expect(rows.find((r) => r.externalGameId === "900002")).toMatchObject({ matchedGameId: null, matchConfidencePct: 0 });
    const after = rows.filter((r) => before.some((b) => b[0] === r.id)).map((r) => [r.id, r.matchedGameId, r.matchConfidencePct]);
    expect(after).toEqual(before);
  });

  it("標題重複的候選競爭（needsReview）不採用：兩款同名遊戲 → 寫信心值、matchedGameId 為 NULL", async () => {
    const a = await insertGame(970011, "stm7-twin-a", "Twinblade Saga", undefined, "2019-01-01");
    const b = await insertGame(970012, "stm7-twin-b", "Twinblade Saga", undefined, "2019-06-01");
    gameIds.push(a, b);
    const [row] = await getDb().insert(ownedGames).values({ connectedAccountId: accountId, externalGameId: "900010", externalTitle: "Twinblade Saga" }).returning();
    await matchOwnedGames({});
    const [after] = await getDb().select().from(ownedGames).where(eq(ownedGames.id, row!.id));
    expect(after!.matchedGameId).toBeNull();
    expect(after!.matchConfidencePct).toBeGreaterThanOrEqual(85);
  });

  it("匯入對象排除 credential：沒有 Steam 的帳號不會被比對或匯入；遊戲被刪 → matchedGameId 變 NULL（FK SET NULL）", async () => {
    const outcome = await importOwnedGames({ userId: 0, provider: "steam", apiKey: API_KEY, fetch: fakeSteam, now: T0 });
    expect(outcome).toEqual({ ok: false, code: "steam_not_linked" });
    const [stardew] = await getDb().select().from(ownedGames).where(eq(ownedGames.externalGameId, "413150"));
    expect(stardew!.matchedGameId).toBe(gameIds[2]);
    await getDb().delete(games).where(eq(games.id, gameIds[2]!));
    const [after] = await getDb().select().from(ownedGames).where(eq(ownedGames.id, stardew!.id));
    expect(after!.matchedGameId).toBeNull();
    expect(after!.matchConfidencePct).toBeGreaterThan(0);
    gameIds.splice(2, 1);
  });

  it("getOwnedGamesPage 直接呼叫；刪除 connected account 時 owned_games cascade 清除", async () => {
    const page = await getOwnedGamesPage({ id: accountId, providerAccountId: IMPORT_ID }, 50, 0);
    expect(page.summary.total).toBeGreaterThan(0);
    await getDb().delete(connectedAccounts).where(eq(connectedAccounts.id, accountId));
    expect(await owned()).toHaveLength(0);
    // 帳號本身仍在
    expect((await getDb().select().from(users).where(eq(users.id, userId))).length).toBe(1);
  });

  it("刪除使用者 → connected_accounts 與 owned_games 一路 cascade", async () => {
    const c = await signUp("stm7-cascade@example.com");
    const b = await begin({ cookie: c });
    await callback(assertion("76561198000007777", b.n), b.cookie);
    const [u] = await getDb().select().from(users).where(eq(users.email, "stm7-cascade@example.com"));
    const [acct] = (await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u!.id))).filter((x) => x.provider === "steam");
    await getDb().insert(ownedGames).values({ connectedAccountId: acct!.id, externalGameId: "1", externalTitle: "X" });
    await getDb().delete(users).where(eq(users.id, u!.id));
    expect(await getDb().select().from(ownedGames).where(eq(ownedGames.connectedAccountId, acct!.id))).toHaveLength(0);
  });

  it("accounts manifest：owned_games 在 ownedTables", () => {
    expect(accountsModule.ownedTables).toContain("owned_games");
  });
});
