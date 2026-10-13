/**
 * 時間軸「按需載入」的 route handler 本體（app/api/timeline/** 只是薄路由）。
 * 讀 DB 的 GET：先 `await connection()`（Next 16.4 cacheComponents）；查詢逾時回 503；語系不支援回 400。
 * 篩選條件與頁面共用同一組 query 參數（`parseFilterSpec`），另有 `locale`、`cursor`、`at`、`key`、`offset`、`ids`。
 */
import { connection } from "next/server";
import { parseFilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { isCatalogQueryTimeoutError } from "../../domain/entities/read-errors";
import { loadTimelineChunk, loadTimelineGroup, loadTimelineHistory } from "./server";

const MAX_IDS = 200;
const HEADERS = { "Cache-Control": "public, max-age=60" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: status === 200 ? HEADERS : { "Cache-Control": "no-store" } });
}

function localeOf(params: URLSearchParams): Locale | null {
  const v = params.get("locale") ?? "";
  return isSupportedLocale(v, getLocaleConfig()) ? (v as Locale) : null;
}

async function guarded(request: Request, run: (params: URLSearchParams, locale: Locale) => Promise<Response>): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const locale = localeOf(params);
  if (!locale) return json({ error: "invalid_locale" }, 400);
  try {
    return await run(params, locale);
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) return json({ error: "timeout" }, 503);
    throw err;
  }
}

export function timelineChunkResponse(request: Request): Promise<Response> {
  return guarded(request, async (params, locale) => {
    const { chunk } = await loadTimelineChunk({
      locale,
      spec: parseFilterSpec(params).filter,
      cursor: params.get("cursor"),
      at: params.get("at"),
    });
    return json(chunk);
  });
}

export function timelineGroupResponse(request: Request): Promise<Response> {
  return guarded(request, async (params, locale) => {
    const groupKey = params.get("key") ?? "";
    if (groupKey === "" || groupKey.length > 40) return json({ error: "invalid_key" }, 400);
    const offset = params.get("offset");
    const res = await loadTimelineGroup({
      locale,
      spec: parseFilterSpec(params).filter,
      groupKey,
      offset: offset !== null && /^\d{1,6}$/.test(offset) ? Number(offset) : undefined,
    });
    return json(res);
  });
}

export function timelineHistoryResponse(request: Request): Promise<Response> {
  return guarded(request, async (params, locale) => {
    const ids = (params.get("ids") ?? "")
      .split(",")
      .filter((s) => /^\d{1,12}$/.test(s))
      .map(Number)
      .slice(0, MAX_IDS);
    if (ids.length === 0) return json({ error: "invalid_ids" }, 400);
    return json(await loadTimelineHistory(locale, ids));
  });
}
