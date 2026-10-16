/**
 * `/api/v1/imports/{provider}` 的請求處理（薄路由 app/api/v1/imports/[provider] 經 api/imports.ts 呼叫）。非 Better Auth 端點，
 * 所以自己做登入與 Origin 檢查（來源清單與 Better Auth 的 trustedOrigins 是同一份：parseAccountsEnv().trustedOrigins）。
 *
 * POST：404（不支援的 provider）→ 403（Origin）→ 401（未登入）→ 409 steam_not_linked → 503 steam_import_unavailable（沒設金鑰）
 *       → 429 import_cooldown（10 分鐘）→ 202 { imported, total }；比對不在請求內做，交給 deps.defer（Next 的 after）。
 * GET ：目前使用者的匯入摘要與清單（?limit=1..100，預設 50；?offset=）。
 * 回應一律 Cache-Control: no-store。
 */
import { IMPORT_COOLDOWN_MS, OWNED_GAME_STATUSES, isImportProvider, type ImportErrorCode, type OwnedGameStatus } from "../domain/entities/owned-game";
import { parseAccountsEnv } from "../providers/auth";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { parseIdParam } from "../domain/entities/lists";
import { getCurrentUser } from "./current-user";
import { findOwnedGamesTarget, getMatchCandidates, getOwnedGamesPage, importOwnedGames, matchOwnedGames, setManualMatch, type ManualMatchChange } from "./owned-games";

export interface ImportRequestDeps {
  /** 回應之後執行背景工作（Next 的 after）。 */
  defer: (task: () => Promise<void>) => void;
  /** 測試注入假的 Steam 回應。 */
  fetch?: typeof fetch;
  now?: Date;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const STATUS: Record<ImportErrorCode, number> = {
  steam_not_linked: 409,
  steam_import_unavailable: 503,
  steam_profile_private: 422,
  steam_upstream_error: 502,
  import_cooldown: 429,
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

/** Origin（沒有時用 Referer）必須在信任清單內。沒有信任清單時（未設 NEXT_PUBLIC_SITE_URL）退回請求自己的 origin。 */
export function isTrustedRequestOrigin(request: Request, trusted: readonly string[]): boolean {
  const raw = request.headers.get("origin") ?? request.headers.get("referer");
  if (!raw || raw === "null") return false;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return false;
  }
  const allowed = trusted.length > 0 ? trusted : [new URL(request.url).origin];
  return allowed.includes(origin);
}

/** 回應之後的背景比對：一個帳號最多連跑幾批（每批上限見 MATCH_BATCH_SIZE），其餘交給排程。 */
const AFTER_MAX_BATCHES = 10;

export async function handleImportRequest(request: Request, providerParam: string, deps: ImportRequestDeps): Promise<Response> {
  if (!isImportProvider(providerParam)) return json({ code: "not_found" }, 404);
  const provider = providerParam;
  if (request.method !== "POST" && request.method !== "GET") return json({ code: "method_not_allowed" }, 405, { Allow: "GET, POST" });
  const isPost = request.method === "POST";
  const env = parseAccountsEnv();
  if (isPost && !isTrustedRequestOrigin(request, env.trustedOrigins)) return json({ code: "invalid_origin" }, 403);

  const user = await getCurrentUser(request.headers);
  if (!user) return json({ code: "unauthorized" }, 401);
  const target = await findOwnedGamesTarget(user.id, provider);
  if (!target) return json({ code: "steam_not_linked" }, STATUS.steam_not_linked);

  if (!isPost) {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
    // ?status= 篩選（第 5 波畫面需要：清單分頁載入，不能只在前端過濾已載入的列）；不認得的值忽略＝全部
    const statusParam = url.searchParams.get("status");
    const status = (OWNED_GAME_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as OwnedGameStatus) : undefined;
    const page = await getOwnedGamesPage(target, limit, offset, status);
    const last = page.summary.lastImportedAt ? Date.parse(page.summary.lastImportedAt) : null;
    const now = (deps.now ?? new Date()).getTime();
    const cooldownSec = last !== null && last + IMPORT_COOLDOWN_MS > now ? Math.ceil((last + IMPORT_COOLDOWN_MS - now) / 1000) : 0;
    return json({ importAvailable: !!env.steamApiKey, cooldownSec, ...page }, 200);
  }

  const outcome = await importOwnedGames({ userId: user.id, provider, apiKey: env.steamApiKey, now: deps.now, fetch: deps.fetch });
  if (!outcome.ok) {
    return json({ code: outcome.code }, STATUS[outcome.code], outcome.retryAfterSec ? { "Retry-After": String(outcome.retryAfterSec) } : {});
  }
  const accountId = outcome.connectedAccountId;
  deps.defer(async () => {
    try {
      for (let i = 0; i < AFTER_MAX_BATCHES; i++) {
        const s = await matchOwnedGames({ connectedAccountId: accountId, log: deps.log });
        if (s.processed === 0) break;
      }
    } catch (e) {
      deps.log?.("match_owned_games_after_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return json({ imported: outcome.imported, total: outcome.total }, 202);
}

/**
 * PATCH /api/v1/imports/{provider}/games/{ownedGameId}（第 5 波：手動指定比對）。
 * body：{ gameId: number } 指定｜{ gameId: null } 否決（這不是 catalog 的任何遊戲）｜{ reset: true } 回到自動（交給比對重跑）。
 * 404 不支援的 provider／owned_game_not_found（含別人的列）／game_not_found → 403 Origin → 401 → 409 steam_not_linked → 400 validation_failed → 200 { item, summary }。
 */
export async function handleManualMatchRequest(request: Request, providerParam: string, ownedGameParam: string, deps: ImportRequestDeps): Promise<Response> {
  if (!isImportProvider(providerParam)) return json({ code: "not_found" }, 404);
  if (request.method !== "PATCH") return json({ code: "method_not_allowed" }, 405, { Allow: "PATCH" });
  const env = parseAccountsEnv();
  if (!isTrustedRequestOrigin(request, env.trustedOrigins)) return json({ code: "invalid_origin" }, 403);
  const user = await getCurrentUser(request.headers);
  if (!user) return json({ code: "unauthorized" }, 401);
  const target = await findOwnedGamesTarget(user.id, providerParam);
  if (!target) return json({ code: "steam_not_linked" }, STATUS.steam_not_linked);
  const ownedGameId = parseIdParam(ownedGameParam);
  if (ownedGameId === null) return json({ code: "owned_game_not_found" }, 404);

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ code: "invalid_json" }, 400);
  }
  const rec = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  let change: ManualMatchChange | null = null;
  if (rec) {
    const hasGame = "gameId" in rec;
    const hasReset = "reset" in rec;
    if (hasGame && !hasReset) {
      const g = rec.gameId;
      if (g === null) change = { kind: "dismiss" };
      else if (typeof g === "number" && Number.isSafeInteger(g) && g > 0) change = { kind: "assign", gameId: g };
    } else if (hasReset && !hasGame && rec.reset === true) change = { kind: "reset" };
  }
  if (!change) return json({ code: "validation_failed", fields: { body: "gameId_or_reset_required" } }, 400);

  const res = await setManualMatch(target, ownedGameId, change);
  if (!res.ok) return json({ code: res.code }, 404);
  if (change.kind === "reset") {
    deps.defer(async () => {
      try {
        await matchOwnedGames({ connectedAccountId: target.id, log: deps.log });
      } catch (e) {
        deps.log?.("match_owned_games_after_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    });
  }
  return json({ item: res.item, summary: res.summary }, 200);
}

/** GET /api/v1/imports/{provider}/games/{ownedGameId}/candidates?locale=：{ items:[{ game: GameMiniCard, confidencePct }] }（信心高到低）。 */
export async function handleMatchCandidatesRequest(request: Request, providerParam: string, ownedGameParam: string): Promise<Response> {
  if (!isImportProvider(providerParam)) return json({ code: "not_found" }, 404);
  if (request.method !== "GET") return json({ code: "method_not_allowed" }, 405, { Allow: "GET" });
  const user = await getCurrentUser(request.headers);
  if (!user) return json({ code: "unauthorized" }, 401);
  const target = await findOwnedGamesTarget(user.id, providerParam);
  if (!target) return json({ code: "steam_not_linked" }, STATUS.steam_not_linked);
  const ownedGameId = parseIdParam(ownedGameParam);
  if (ownedGameId === null) return json({ code: "owned_game_not_found" }, 404);
  const rawLocale = new URL(request.url).searchParams.get("locale");
  const locale = rawLocale && isSupportedLocale(rawLocale, getLocaleConfig()) ? rawLocale : null;
  const items = await getMatchCandidates(target, ownedGameId, locale);
  return items ? json({ items }, 200) : json({ code: "owned_game_not_found" }, 404);
}
