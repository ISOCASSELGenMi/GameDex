/**
 * 追蹤、me/follows/state、me/games 的 HTTP 處理（07；薄路由 app/api/v1/{follows,me} 經 api/follows.ts 呼叫）。
 * 慣例同 account-data-request.ts：寫入先 403（Origin）再 401；錯誤一律 { code }；一律 Cache-Control: no-store，
 * 唯一例外是公開的追蹤人數（public, s-maxage=300）。
 */
import { isValidIsoDate } from "@/modules/catalog";
import { FOLLOW_LIST_LIMIT_MAX, isFollowTarget, parseFollowPath, parseStateTargets } from "../domain/entities/follows";
import { authenticate, code, intParam, invalid, json, localeParam, methodNotAllowed } from "./account-data-request";
import { followTarget, getFollowStates, getMyFollows, getPublicFollowCount, unfollowTarget } from "./follows";
import { getMyGamesPage, parseMineParam } from "./my-games";

const FAILURE_STATUS: Record<string, number> = {
  target_not_found: 404,
  follow_limit_reached: 429,
  list_not_found: 404,
};
const failure = (c: string): Response => code(c, FAILURE_STATUS[c] ?? 400);

/** GET /api/v1/follows?targetType=&limit=&offset=&locale= —— 本人的追蹤清單。 */
export async function handleFollows(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  const params = new URL(request.url).searchParams;
  const rawType = params.get("targetType");
  if (rawType !== null && !isFollowTarget(rawType)) return invalid({ targetType: "invalid" });
  const limit = intParam(request, "limit");
  if (limit !== undefined && (limit < 1 || limit > FOLLOW_LIST_LIMIT_MAX)) return invalid({ limit: "out_of_range" });
  const offset = intParam(request, "offset");
  if (offset !== undefined && offset < 0) return invalid({ offset: "out_of_range" });
  return json(
    await getMyFollows(a.user.id, { targetType: rawType ?? undefined, limit, offset, locale: localeParam(request) }),
    200,
  );
}

/** PUT（追蹤，冪等）、DELETE（取消，冪等）/api/v1/follows/{targetType}/{targetId}。 */
export async function handleFollowTarget(request: Request, typeParam: string, idParam: string): Promise<Response> {
  if (request.method !== "PUT" && request.method !== "DELETE") return methodNotAllowed("PUT, DELETE");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const key = parseFollowPath(typeParam, idParam);
  if (!key) return failure("target_not_found");
  if (request.method === "DELETE") {
    const { removed } = await unfollowTarget(a.user.id, key);
    return json({ following: false, removed }, 200);
  }
  const res = await followTarget(a.user.id, key);
  if (!res.ok) return failure(res.code);
  return json({ following: true, created: res.created }, res.created ? 201 : 200);
}

/** GET /api/v1/follows/count/{targetType}/{targetId} —— 公開、與檢視者無關：public, s-maxage=300（404 只快取 60 秒）。 */
export async function handleFollowCount(request: Request, typeParam: string, idParam: string): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const key = parseFollowPath(typeParam, idParam);
  const view = key ? await getPublicFollowCount(key) : null;
  if (!view) return Response.json({ code: "target_not_found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
  return Response.json(view, { headers: { "Cache-Control": "public, s-maxage=300" } });
}

/** GET /api/v1/me/follows/state?targets=game:1,event:2[&withCount=1] —— 一次回多個目標我是否追蹤。 */
export async function handleFollowState(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  const params = new URL(request.url).searchParams;
  const parsed = parseStateTargets(params.get("targets"));
  if (!parsed.ok) return invalid(parsed.fields);
  const withCount = params.get("withCount") === "1";
  return json({ items: await getFollowStates(a.user.id, parsed.value, { withCount }) }, 200);
}

/** GET /api/v1/me/games?mine=followed|owned|collected|list:<id>[,…]&from=&to=&limit=&offset=&locale= —— 我的遊戲。 */
export async function handleMyGames(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const a = await authenticate(request, false);
  if ("response" in a) return a.response;
  const params = new URL(request.url).searchParams;
  const mine = parseMineParam(params.get("mine"));
  if (!mine) return invalid({ mine: params.get("mine") === null ? "required" : "invalid" });
  const from = params.get("from");
  const to = params.get("to");
  const fields: Record<string, string> = {};
  if (from !== null && !isValidIsoDate(from)) fields.from = "invalid";
  if (to !== null && !isValidIsoDate(to)) fields.to = "invalid";
  if (from !== null && to !== null && !fields.from && !fields.to && from > to) fields.to = "before_from";
  const limit = intParam(request, "limit");
  if (limit !== undefined && (limit < 1 || limit > 100)) fields.limit = "out_of_range";
  const offset = intParam(request, "offset");
  if (offset !== undefined && offset < 0) fields.offset = "out_of_range";
  if (Object.keys(fields).length > 0) return invalid(fields);
  const res = await getMyGamesPage(a.user.id, { mine, from, to, limit, offset, locale: localeParam(request) });
  if (!res.ok) return failure(res.code);
  return json({ mine: res.mine, ...res.page }, 200);
}
