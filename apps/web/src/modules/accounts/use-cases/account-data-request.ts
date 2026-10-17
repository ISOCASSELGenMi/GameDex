/**
 * 清單、遊玩紀錄、me/games、玩家平均的 HTTP 處理（07；薄路由 app/api/v1/{lists,play-records,me,player-ratings} 經 api/*.ts 呼叫）。
 * 非 Better Auth 端點，所以自己做登入與 Origin 檢查（沿用 import-request 的 isTrustedRequestOrigin；來源清單同 Better Auth 的 trustedOrigins）。
 * 順序：寫入先 403（Origin）再 401（未登入）。錯誤一律 { code }（驗證失敗多一個 fields）。回應一律 Cache-Control: no-store，
 * 唯一例外是公開的玩家平均（public, s-maxage=300）。
 */
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import type { CurrentUser } from "../domain/entities/account-view";
import {
  LIST_GAMES_MAX,
  parseIdParam,
  validateIdOrder,
  validateListCreate,
  validateListNote,
  validateListPatch,
  LIST_MAX_PER_USER,
} from "../domain/entities/lists";
import { validatePlayRecordCreate, validatePlayRecordPatch } from "../domain/entities/play-records";
import { parseAccountsEnv } from "../providers/auth";
import { getCurrentUser } from "./current-user";
import { isTrustedRequestOrigin } from "./import-request";
import {
  addToList,
  createList,
  getMyLists,
  patchList,
  readList,
  removeFromList,
  removeList,
  reorderListGames,
  reorderLists,
  updateListGameNote,
} from "./lists";
import {
  createPlayRecord,
  getMyGameState,
  getMyPlayRecords,
  getMyPlayStats,
  getPlayerRating,
  patchPlayRecord,
  removePlayRecord,
} from "./play-records";

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

export const code = (c: string, status: number): Response => json({ code: c }, status);

const FAILURE_STATUS: Record<string, number> = {
  list_not_found: 404,
  game_not_found: 404,
  record_not_found: 404,
  not_in_list: 404,
  unauthorized: 401,
  list_limit_reached: 422,
  list_games_limit_reached: 422,
  play_record_limit_reached: 422,
  order_mismatch: 422,
};
const failure = (c: string): Response => code(c, FAILURE_STATUS[c] ?? 400);

export type Authed = { user: CurrentUser } | { response: Response };

/** 寫入：先檢查 Origin（403），再檢查登入（401）。讀取只檢查登入。 */
export async function authenticate(request: Request, write: boolean): Promise<Authed> {
  if (write && !isTrustedRequestOrigin(request, parseAccountsEnv().trustedOrigins)) return { response: code("invalid_origin", 403) };
  const user = await getCurrentUser(request.headers);
  if (!user) return { response: code("unauthorized", 401) };
  return { user };
}

export async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, response: code("payload_too_large", 413) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: code("payload_too_large", 413) };
  if (text.trim() === "") return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: code("invalid_json", 400) };
  }
}

export const invalid = (fields: Record<string, string>): Response => json({ code: "validation_failed", fields }, 400);

export function localeParam(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("locale");
  return raw && isSupportedLocale(raw, getLocaleConfig()) ? raw : null;
}

export function intParam(request: Request, name: string): number | undefined {
  const v = Number.parseInt(new URL(request.url).searchParams.get(name) ?? "", 10);
  return Number.isFinite(v) ? v : undefined;
}

export const methodNotAllowed = (allow: string): Response => json({ code: "method_not_allowed" }, 405, { Allow: allow });

// ── /api/v1/lists ─────────────────────────────────────────────────────────

/** GET 我的清單 { items, limits }；POST 新增 201 { list }。 */
export async function handleLists(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const a = await authenticate(request, false);
    if ("response" in a) return a.response;
    return json({ items: await getMyLists(a.user.id), limits: { maxLists: LIST_MAX_PER_USER, maxGamesPerList: LIST_GAMES_MAX } }, 200);
  }
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validateListCreate(b.body);
  if (!v.ok) return invalid(v.fields);
  const res = await createList(a.user.id, v.value);
  if (!res.ok) return failure(res.code);
  return json({ list: res.list }, 201);
}

/** PATCH /lists/order：{ listIds } 清單之間排序。 */
export async function handleListsOrder(request: Request): Promise<Response> {
  if (request.method !== "PATCH") return methodNotAllowed("PATCH");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validateIdOrder(b.body, "listIds", LIST_MAX_PER_USER);
  if (!v.ok) return invalid(v.fields);
  const res = await reorderLists(a.user.id, v.value);
  if (!res.ok) return failure(res.code);
  return json({ items: await getMyLists(a.user.id) }, 200);
}

/** GET /lists/shared/{token}：unlisted 分享連結（匿名可讀）。 */
export async function handleSharedList(request: Request, token: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const user = await getCurrentUser(request.headers);
  const detail = await readList({
    shareToken: token,
    viewerId: user?.id ?? null,
    locale: localeParam(request),
    limit: intParam(request, "limit"),
    offset: intParam(request, "offset"),
  });
  return detail ? json(detail, 200) : failure("list_not_found");
}

/** GET（匿名可讀 public；本人讀全部）、PATCH、DELETE /lists/{id}。 */
export async function handleList(request: Request, idParam: string): Promise<Response> {
  const id = parseIdParam(idParam);
  if (request.method === "GET") {
    const user = await getCurrentUser(request.headers);
    if (id === null) return failure("list_not_found");
    const detail = await readList({
      listId: id,
      viewerId: user?.id ?? null,
      locale: localeParam(request),
      limit: intParam(request, "limit"),
      offset: intParam(request, "offset"),
    });
    return detail ? json(detail, 200) : failure("list_not_found");
  }
  if (request.method !== "PATCH" && request.method !== "DELETE") return methodNotAllowed("GET, PATCH, DELETE");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  if (id === null) return failure("list_not_found");
  if (request.method === "DELETE") return (await removeList(a.user.id, id)) ? json({ ok: true }, 200) : failure("list_not_found");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validateListPatch(b.body);
  if (!v.ok) return invalid(v.fields);
  const list = await patchList(a.user.id, id, v.value);
  return list ? json({ list }, 200) : failure("list_not_found");
}

/** POST（加入，可帶 { note }）、PATCH（改備註 { note }）、DELETE（移除）/lists/{id}/games/{gameId}。 */
export async function handleListGame(request: Request, idParam: string, gameParam: string): Promise<Response> {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return methodNotAllowed("POST, PATCH, DELETE");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const listId = parseIdParam(idParam);
  const gameId = parseIdParam(gameParam);
  if (listId === null) return failure("list_not_found");
  if (gameId === null) return failure("game_not_found");
  if (request.method === "DELETE") {
    const res = await removeFromList(a.user.id, listId, gameId);
    return res.ok ? json({ ok: true, removed: res.removed }, 200) : failure(res.code);
  }
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const n = validateListNote(b.body, { required: request.method === "PATCH" });
  if (!n.ok) return invalid(n.fields);
  if (request.method === "PATCH") {
    const res = await updateListGameNote(a.user.id, listId, gameId, n.value.note ?? null);
    return res.ok ? json({ entry: res.entry }, 200) : failure(res.code);
  }
  const res = await addToList(a.user.id, listId, gameId, n.value.note);
  if (!res.ok) return failure(res.code);
  return json({ entry: res.entry, created: res.created }, res.created ? 201 : 200);
}

/** PATCH /lists/{id}/order：{ gameIds } 清單內排序。 */
export async function handleListGamesOrder(request: Request, idParam: string): Promise<Response> {
  if (request.method !== "PATCH") return methodNotAllowed("PATCH");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const listId = parseIdParam(idParam);
  if (listId === null) return failure("list_not_found");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validateIdOrder(b.body, "gameIds", LIST_GAMES_MAX);
  if (!v.ok) return invalid(v.fields);
  const res = await reorderListGames(a.user.id, listId, v.value);
  return res.ok ? json({ ok: true }, 200) : failure(res.code);
}

// ── /api/v1/play-records ──────────────────────────────────────────────────

/** GET ?gameId=&limit=&offset=&locale=（本人的紀錄）；POST 新增 201 { record }。 */
export async function handlePlayRecords(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const a = await authenticate(request, false);
    if ("response" in a) return a.response;
    const rawGame = new URL(request.url).searchParams.get("gameId");
    let gameId: number | undefined;
    if (rawGame !== null) {
      const g = parseIdParam(rawGame);
      if (g === null) return invalid({ gameId: "invalid" });
      gameId = g;
    }
    return json(await getMyPlayRecords(a.user.id, { gameId, limit: intParam(request, "limit"), offset: intParam(request, "offset"), locale: localeParam(request) }), 200);
  }
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validatePlayRecordCreate(b.body);
  if (!v.ok) return invalid(v.fields);
  const res = await createPlayRecord(a.user.id, v.value);
  if (!res.ok) return res.code === "validation_failed" ? invalid(res.fields) : failure(res.code);
  return json({ record: res.record }, 201);
}

/** GET /play-records/stats。 */
export async function handlePlayStats(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  return json(await getMyPlayStats(a.user.id), 200);
}

/** PATCH、DELETE /play-records/{id}（只能動自己的；別人的 id 一律 404）。 */
export async function handlePlayRecord(request: Request, idParam: string): Promise<Response> {
  if (request.method !== "PATCH" && request.method !== "DELETE") return methodNotAllowed("PATCH, DELETE");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const id = parseIdParam(idParam);
  if (id === null) return failure("record_not_found");
  if (request.method === "DELETE") return (await removePlayRecord(a.user.id, id)) ? json({ ok: true }, 200) : failure("record_not_found");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = validatePlayRecordPatch(b.body);
  if (!v.ok) return invalid(v.fields);
  const res = await patchPlayRecord(a.user.id, id, v.value);
  if (!res.ok) return res.code === "validation_failed" ? invalid(res.fields) : failure(res.code);
  return json({ record: res.record }, 200);
}

// ── /api/v1/me/games/{gameId}、/api/v1/player-ratings/{gameId} ─────────────

export async function handleMyGame(request: Request, gameParam: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  const gameId = parseIdParam(gameParam);
  if (gameId === null) return failure("game_not_found");
  const state = await getMyGameState(a.user.id, gameId);
  return state ? json(state, 200) : failure("game_not_found");
}

/** 公開、與使用者無關：Cache-Control: public, s-maxage=300（404 只快取 60 秒）。 */
export async function handlePlayerRating(request: Request, gameParam: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const gameId = parseIdParam(gameParam);
  const view = gameId === null ? null : await getPlayerRating(gameId);
  if (!view) return Response.json({ code: "game_not_found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
  return Response.json(view, { headers: { "Cache-Control": "public, s-maxage=300" } });
}
