/**
 * GET /api/v1/timeline/week?locale=&week=2026-W43&at=YYYY-MM-DD&<篩選參數>：時間軸一週（客戶端切週時按需載入）。
 * 薄路由 app/api/v1/timeline/week/route.ts。公開、與使用者無關，可被 CDN 快取。
 *
 * - 篩選與時間軸頁同一組 query（`parseFilterSpec`）；聚合規則由 Use Case `getTimelineWeek`（→ `aggregateReleases`）執行。
 * - `week` 優先；其次 `at`（該日所在週）；都沒有（或格式錯誤）＝今天所在的週。
 * - 回應 200 `TimelineWeekData`；400 `{ error: "invalid_locale" }`；查詢逾時 503 `{ error: "timeout" }`。
 * - 讀 DB 的 GET：先 `await connection()`（Next 16.4 cacheComponents）。
 */
import { connection } from "next/server";
import { parseFilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { isCatalogQueryTimeoutError } from "../../domain/entities/read-errors";
import { loadTimelineWeek } from "./week-server";

export const TIMELINE_WEEK_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? TIMELINE_WEEK_CACHE_CONTROL : "no-store", ...(status === 503 ? { "Retry-After": "30" } : {}) },
  });
}

export async function timelineWeekResponse(request: Request): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const rawLocale = params.get("locale") ?? "";
  if (!isSupportedLocale(rawLocale, getLocaleConfig())) return json({ error: "invalid_locale" }, 400);
  const locale = rawLocale as Locale;
  try {
    const { data } = await loadTimelineWeek({ locale, spec: parseFilterSpec(params).filter, week: params.get("week"), at: params.get("at") });
    return json(data);
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) return json({ error: "timeout" }, 503);
    throw err;
  }
}
