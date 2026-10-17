/**
 * 私人 iCal 訂閱的 HTTP 處理（07、08；薄路由 app/api/v1/calendar/** 與 app/ical/u/** 經 api/calendar.ts 呼叫）。
 * - 管理 API：慣例同 account-data-request.ts（寫入先 403 再 401；no-store；錯誤 { code }）。
 * - /ical/u/{token}.ics：token 即憑證（bearer），不看 Cookie／Session，所以回應不會有 Set-Cookie；
 *   Cache-Control: private, max-age=300（不進 CDN）；ETag／304；token 不存在 404；撤銷 30 天內空 ics、之後 410。
 */
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { RELEASE_STAGES, icalLinks, ifNoneMatchHits, requestOrigin, ICAL_CONTENT_TYPE, isCatalogQueryTimeoutError } from "@/modules/catalog";
import { FEED_CACHE_CONTROL, tokenFromIcsFile, validateFeedPatch } from "../domain/entities/calendar-feeds";
import { parseIdParam } from "../domain/entities/lists";
import { authenticate, code, invalid, json, methodNotAllowed, readBody } from "./account-data-request";
import { ensureFollowingFeed, lookupPrivateFeed, patchFeed, preparePrivateFeed, recordFeedAccess, rotateFollowingFeed } from "./calendar-feeds";

const FAILURE_STATUS: Record<string, number> = { feed_not_found: 404, rate_limited: 429 };
const failure = (c: string): Response =>
  FAILURE_STATUS[c] === 429 ? json({ code: c }, 429, { "Retry-After": "3600" }) : code(c, FAILURE_STATUS[c] ?? 400);

/** GET（沒有就建立）、POST（同 GET，新建時回 201）/api/v1/calendar/feeds → { feed, created }。 */
export async function handleFeeds(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed("GET, POST");
  const a = await authenticate(request, request.method === "POST");
  if ("response" in a) return a.response;
  const res = await ensureFollowingFeed(a.user.id, requestOrigin(request));
  if (!res.ok) return failure(res.code);
  return json({ feed: res.feed, created: res.created }, request.method === "POST" && res.created ? 201 : 200);
}

/** PATCH /api/v1/calendar/feeds/{id} → { feed, changed }。 */
export async function handleFeed(request: Request, idParam: string): Promise<Response> {
  if (request.method !== "PATCH") return methodNotAllowed("PATCH");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const id = parseIdParam(idParam);
  if (id === null) return failure("feed_not_found");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const config = getLocaleConfig();
  const v = validateFeedPatch(b.body, {
    isSupportedLocale: (l) => isSupportedLocale(l, config),
    isKnownStage: (s) => (RELEASE_STAGES as readonly string[]).includes(s),
  });
  if (!v.ok) return invalid(v.fields);
  const res = await patchFeed(a.user.id, id, v.value, requestOrigin(request));
  if (!res.ok) return res.code === "validation_failed" ? invalid(res.fields) : failure(res.code);
  return json({ feed: res.feed, changed: res.changed }, 200);
}

/** POST /api/v1/calendar/feeds/{id}/rotate → { feed }（新網址；舊網址 30 天內回空 ics、之後 410）。 */
export async function handleFeedRotate(request: Request, idParam: string): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const a = await authenticate(request, true);
  if ("response" in a) return a.response;
  const id = parseIdParam(idParam);
  if (id === null) return failure("feed_not_found");
  const res = await rotateFollowingFeed(a.user.id, id, requestOrigin(request));
  return res.ok ? json({ feed: res.feed }, 200) : failure(res.code);
}

// ── /ical/u/{token}.ics ─────────────────────────────────────────────────

const NO_STORE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
} as const;

/** token 不存在、格式不對、帳號已刪除。 */
const notFound = (): Response => new Response("not found", { status: 404, headers: NO_STORE_HEADERS });
/** 撤銷超過 30 天。 */
const gone = (): Response => new Response("gone", { status: 410, headers: NO_STORE_HEADERS });

function feedLocale(raw: string) {
  const config = getLocaleConfig();
  return isSupportedLocale(raw, config) ? raw : config.defaultLocale;
}

/** GET（HEAD）/ical/u/{token}.ics。`file` 是路徑最後一段（含 .ics）。呼叫端（api/calendar.ts）已 await connection()。 */
export async function handlePrivateIcs(request: Request, file: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { ...NO_STORE_HEADERS, Allow: "GET, HEAD" } });
  }
  const token = tokenFromIcsFile(file);
  if (!token) return notFound();
  const lookup = await lookupPrivateFeed(token);
  if (lookup.state === "not_found") return notFound();
  if (lookup.state === "gone") return gone();
  try {
    const feed = await preparePrivateFeed(lookup.feed, { revoked: lookup.revoked, links: icalLinks(feedLocale(lookup.feed.locale), request) });
    await recordFeedAccess(lookup.feed.id);
    const common = { "Cache-Control": FEED_CACHE_CONTROL, ETag: feed.etag, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
    if (ifNoneMatchHits(request.headers.get("if-none-match"), feed.etag)) return new Response(null, { status: 304, headers: common });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { ...common, "Content-Type": ICAL_CONTENT_TYPE } });
    return new Response(await feed.render(), { status: 200, headers: { ...common, "Content-Type": ICAL_CONTENT_TYPE } });
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) {
      return new Response("temporarily unavailable", { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": "60" } });
    }
    throw err;
  }
}
