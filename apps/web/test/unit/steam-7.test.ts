/**
 * Phase 7 第 3 波單元測試（不需要資料庫、不連 Steam）：站內路徑檢查、比對狀態、Steam Web API 用戶端（假 fetch）、
 * OpenID 驗證（假 fetch）、Origin 檢查、環境變數、排程任務註冊。
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cronMaxIntervalMs } from "@/kernel/scheduler/cron-interval";
import { accountsModule } from "@/modules/accounts";
import {
  EXTERNAL_ID_SOURCE,
  IMPORT_COOLDOWN_MS,
  IMPORT_PROVIDERS,
  isImportProvider,
  ownedGameStatus,
  safeRelativePath,
  withQueryParam,
} from "@/modules/accounts/domain/entities";
import { buildSteamAuthUrl, parseAccountsEnv, STEAM_OP_ENDPOINT, verifySteamAssertion } from "@/modules/accounts/providers/auth";
import { createSteamClient, parseOwnedGames, parsePlayerSummary, SteamApiError } from "@/modules/accounts/providers/steam";
import { safeNextPath } from "@/modules/accounts/ui/links";
import { isTrustedRequestOrigin } from "@/modules/accounts/use-cases/import-request";

const KEY = randomBytes(32).toString("base64");
const baseEnv = { AUTH_SECRET: "unit-test-auth-secret-0123456789abcdefghij", TOKEN_ENCRYPTION_KEY: KEY, NODE_ENV: "test" };
const SECRET_KEY = "STEAMKEY-DO-NOT-LEAK-0123456789";
const STEAM_ID = "76561198000000001";

describe("safeRelativePath／withQueryParam（唯一實作；safeNextPath 沿用）", () => {
  it("只接受以單一 / 開頭的站內路徑", () => {
    expect(safeRelativePath("/zh-Hant/account", "/x")).toBe("/zh-Hant/account");
    expect(safeRelativePath("/a?b=1#c", "/x")).toBe("/a?b=1#c");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil", "javascript:alert(1)", "evil", "", null, undefined, "/a\nb", "/a\u0000b"]) {
      expect(safeRelativePath(bad, "/x"), String(bad)).toBe("/x");
    }
    expect(safeNextPath("//evil.example", "/fallback")).toBe("/fallback");
  });
  it("withQueryParam：已有 ? 用 &，保留 #", () => {
    expect(withQueryParam("/a", "error", "x")).toBe("/a?error=x");
    expect(withQueryParam("/a?p=1", "error", "x y")).toBe("/a?p=1&error=x%20y");
    expect(withQueryParam("/a#h", "error", "x")).toBe("/a?error=x#h");
  });
});

describe("匯入常數與比對狀態", () => {
  it("目前只支援 steam，來源對應 external_ids.source=steam，冷卻 10 分鐘", () => {
    expect(IMPORT_PROVIDERS).toEqual(["steam"]);
    expect(isImportProvider("steam")).toBe(true);
    expect(isImportProvider("xbox")).toBe(false);
    expect(EXTERNAL_ID_SOURCE.steam).toBe("steam");
    expect(IMPORT_COOLDOWN_MS).toBe(600_000);
  });
  it("ownedGameStatus：NULL＝未比對、0＝找不到、>0 且沒有遊戲＝待確認、有遊戲＝已比對", () => {
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: null })).toBe("queued");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 0 })).toBe("not_found");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 72 })).toBe("needs_review");
    expect(ownedGameStatus({ matchedGameId: 5, matchConfidencePct: 100 })).toBe("matched");
  });
});

describe("parseOwnedGames", () => {
  it("公開清單：轉成我方型別、去重、缺名稱給預設", () => {
    const games = parseOwnedGames({
      response: {
        game_count: 4,
        games: [
          { appid: 10, name: "  Counter-Strike ", playtime_forever: 5 },
          { appid: 20 },
          { appid: 10, name: "dup" },
          { appid: "x", name: "bad" },
        ],
      },
    });
    expect(games).toEqual([
      { externalGameId: "10", title: "dup" },
      { externalGameId: "20", title: "App 20" },
    ]);
  });
  it("公開但沒有遊戲（game_count: 0）→ 空陣列", () => {
    expect(parseOwnedGames({ response: { game_count: 0 } })).toEqual([]);
  });
  it('個人檔案非公開：{"response":{}} → steam_profile_private', () => {
    expect(() => parseOwnedGames({ response: {} })).toThrowError(expect.objectContaining({ code: "steam_profile_private" }));
  });
  it("格式錯誤 → steam_upstream_error", () => {
    for (const bad of [null, [], { response: "x" }, { response: { games: "x", game_count: 1 } }]) {
      expect(() => parseOwnedGames(bad)).toThrowError(expect.objectContaining({ code: "steam_upstream_error" }));
    }
  });
  it("parsePlayerSummary：暱稱與 https 頭像；缺資料回 null", () => {
    expect(parsePlayerSummary({ response: { players: [{ personaname: " Neo ", avatarfull: "https://a/x.jpg" }] } })).toEqual({ name: "Neo", image: "https://a/x.jpg" });
    expect(parsePlayerSummary({ response: { players: [{ personaname: "N", avatarfull: "http://a/x.jpg" }] } })).toEqual({ name: "N", image: undefined });
    expect(parsePlayerSummary({ response: { players: [] } })).toBeNull();
  });
});

describe("Steam Web API 用戶端（假 fetch）", () => {
  const reply = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });

  it("GetOwnedGames：URL 帶 include_appinfo／include_played_free_games，逾時 10 秒的 signal", async () => {
    let seen = "";
    let signal: AbortSignal | null | undefined;
    const fake: typeof fetch = async (url, init) => {
      seen = String(url);
      signal = init?.signal;
      return new Response(JSON.stringify({ response: { game_count: 1, games: [{ appid: 7, name: "Seven" }] } }));
    };
    const games = await createSteamClient({ apiKey: SECRET_KEY, fetch: fake }).getOwnedGames(STEAM_ID);
    expect(games).toEqual([{ externalGameId: "7", title: "Seven" }]);
    const u = new URL(seen);
    expect(u.origin + u.pathname).toBe("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
    expect(u.searchParams.get("steamid")).toBe(STEAM_ID);
    expect(u.searchParams.get("include_appinfo")).toBe("1");
    expect(u.searchParams.get("include_played_free_games")).toBe("1");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("非公開 / 401 / 403 / 429 / 5xx / 非 JSON：錯誤碼正確", async () => {
    const run = (f: typeof fetch) => createSteamClient({ apiKey: SECRET_KEY, fetch: f }).getOwnedGames(STEAM_ID);
    await expect(run(reply({ response: {} }))).rejects.toMatchObject({ code: "steam_profile_private" });
    await expect(run(reply({}, 401))).rejects.toMatchObject({ code: "steam_key_rejected" });
    await expect(run(reply({}, 403))).rejects.toMatchObject({ code: "steam_key_rejected" });
    await expect(run(reply({}, 429))).rejects.toMatchObject({ code: "steam_upstream_error" });
    await expect(run(reply({}, 500))).rejects.toMatchObject({ code: "steam_upstream_error" });
    await expect(run(async () => new Response("<html>", { status: 200 }))).rejects.toMatchObject({ code: "steam_upstream_error" });
  });

  it("逾時／連線失敗 → steam_upstream_error；錯誤訊息不含 API key 或網址", async () => {
    const boom: typeof fetch = async (url) => {
      throw new Error(`connect ECONNRESET ${String(url)}`);
    };
    const abort: typeof fetch = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    for (const f of [boom, abort, reply({}, 401), reply({}, 500)]) {
      const err = await createSteamClient({ apiKey: SECRET_KEY, fetch: f }).getOwnedGames(STEAM_ID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SteamApiError);
      const e = err as SteamApiError;
      expect(e.message).not.toContain(SECRET_KEY);
      expect(e.message).not.toContain("api.steampowered.com");
      expect(String(e.stack)).not.toContain(SECRET_KEY);
      expect(JSON.stringify(e)).not.toContain(SECRET_KEY);
    }
  });

  it("真的逾時：timeoutMs 到就中止", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    await expect(createSteamClient({ apiKey: SECRET_KEY, fetch: hang, timeoutMs: 30 }).getOwnedGames(STEAM_ID)).rejects.toMatchObject({ code: "steam_upstream_error" });
  });
});

describe("OpenID 驗證（假 fetch）", () => {
  const BASE = "http://localhost:3000/api/v1/auth";
  const returnTo = `${BASE}/steam/callback?n=abc`;
  const q = (over: Record<string, string> = {}): Record<string, string> => ({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OP_ENDPOINT,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": returnTo,
    "openid.response_nonce": new Date().toISOString().replace(/\.\d+Z$/, "Z") + "x",
    "openid.sig": "c2ln",
    n: "abc",
    ...over,
  });
  const yes: typeof fetch = async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");

  it("buildSteamAuthUrl：checkid_setup、identifier_select、realm", () => {
    const u = new URL(buildSteamAuthUrl(returnTo, "http://localhost:3000"));
    expect(u.origin + u.pathname).toBe(STEAM_OP_ENDPOINT);
    expect(u.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(u.searchParams.get("openid.return_to")).toBe(returnTo);
    expect(u.searchParams.get("openid.realm")).toBe("http://localhost:3000");
    expect(u.searchParams.get("openid.identity")).toBe("http://specs.openid.net/auth/2.0/identifier_select");
  });

  it("通過：向 Steam 送 check_authentication，is_valid:true", async () => {
    let body = "";
    const f: typeof fetch = async (_u, init) => {
      body = String(init?.body);
      return new Response("is_valid:true\n");
    };
    expect(await verifySteamAssertion(q(), returnTo, f)).toEqual({ ok: true, steamId: STEAM_ID });
    expect(body).toContain("openid.mode=check_authentication");
  });

  const bad: [string, Record<string, string>, string][] = [
    ["mode 不是 id_res", { "openid.mode": "cancel" }, "not_id_res"],
    ["op_endpoint 被換", { "openid.op_endpoint": "https://evil.example/openid/login" }, "bad_op_endpoint"],
    ["return_to 被換", { "openid.return_to": "http://localhost:3000/other" }, "bad_return_to"],
    ["claimed_id 網域不對", { "openid.claimed_id": "https://evil.example/openid/id/76561198000000009", "openid.identity": "https://evil.example/openid/id/76561198000000009" }, "bad_claimed_id"],
    ["claimed_id 位數不對", { "openid.claimed_id": "https://steamcommunity.com/openid/id/123", "openid.identity": "https://steamcommunity.com/openid/id/123" }, "bad_claimed_id"],
    ["identity 與 claimed_id 不同", { "openid.identity": "https://steamcommunity.com/openid/id/76561198000000009" }, "identity_mismatch"],
    ["nonce 過期", { "openid.response_nonce": "2020-01-01T00:00:00Zxyz" }, "stale_nonce"],
  ];
  for (const [title, over, reason] of bad) {
    it(`拒絕：${title}`, async () => {
      expect(await verifySteamAssertion(q(over), returnTo, yes)).toEqual({ ok: false, reason });
    });
  }
  it("拒絕：is_valid:false、HTTP 錯誤、網路錯誤", async () => {
    expect(await verifySteamAssertion(q(), returnTo, async () => new Response("is_valid:false\n"))).toEqual({ ok: false, reason: "not_valid" });
    expect(await verifySteamAssertion(q(), returnTo, async () => new Response("x", { status: 500 }))).toEqual({ ok: false, reason: "network" });
    expect(
      await verifySteamAssertion(q(), returnTo, async () => {
        throw new Error("x");
      }),
    ).toEqual({ ok: false, reason: "network" });
  });
});

describe("Origin 檢查（匯入端點）", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/v1/imports/steam", { method: "POST", headers });
  it("Origin 必須在信任清單；沒有時看 Referer；null／缺少一律拒絕", () => {
    const trusted = ["https://sok.example"];
    expect(isTrustedRequestOrigin(req({ origin: "https://sok.example" }), trusted)).toBe(true);
    expect(isTrustedRequestOrigin(req({ origin: "https://evil.example" }), trusted)).toBe(false);
    expect(isTrustedRequestOrigin(req({ origin: "null" }), trusted)).toBe(false);
    expect(isTrustedRequestOrigin(req({}), trusted)).toBe(false);
    expect(isTrustedRequestOrigin(req({ referer: "https://sok.example/zh-Hant/account" }), trusted)).toBe(true);
    expect(isTrustedRequestOrigin(req({ referer: "https://evil.example/x" }), trusted)).toBe(false);
    // 沒有信任清單：退回請求自己的 origin
    expect(isTrustedRequestOrigin(req({ origin: "http://localhost:3000" }), [])).toBe(true);
    expect(isTrustedRequestOrigin(req({ origin: "http://localhost:4000" }), [])).toBe(false);
  });
});

describe("環境變數與模組 manifest", () => {
  it("STEAM_WEB_API_KEY 選填（空字串視為未設），不是 requiredEnv", () => {
    expect(parseAccountsEnv(baseEnv).steamApiKey).toBeUndefined();
    expect(parseAccountsEnv({ ...baseEnv, STEAM_WEB_API_KEY: "  " }).steamApiKey).toBeUndefined();
    expect(parseAccountsEnv({ ...baseEnv, STEAM_WEB_API_KEY: SECRET_KEY }).steamApiKey).toBe(SECRET_KEY);
    expect(accountsModule.requiredEnv).not.toContain("STEAM_WEB_API_KEY");
  });
  it("owned_games 列入 ownedTables；match_owned_games 是每 15 分鐘（非整點）的 session 鎖任務", () => {
    expect(accountsModule.ownedTables).toContain("owned_games");
    const job = accountsModule.jobs?.find((j) => j.name === "match_owned_games");
    expect(job).toBeDefined();
    expect(job?.lockMode).toBe("session");
    expect(job?.cron).toBe("7,22,37,52 * * * *");
    expect(cronMaxIntervalMs(job!.cron!)).toBe(15 * 60_000);
  });
});
