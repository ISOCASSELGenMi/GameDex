/**
 * GET /api/v1/calendar/day?date=YYYY-MM-DD&locale=&<篩選參數>：月曆某一天的全部遊戲卡片（格內切換時按需載入）。
 * 薄路由 app/api/v1/calendar/day/route.ts。公開、與使用者無關，可被 CDN 快取。
 *
 * - 篩選：與月曆頁同一組 query（`parseFilterSpec` → `filterSpecForPage(…, "calendar")` → `filterSpecToReadQuery`），
 *   聚合規則由 Use Case `getCalendarDay`（→ `aggregateReleases`）執行，沒有另寫一份。
 * - 回應 200 `{ date, total, cards: DayCardData[] }`；`show` 不含 releases 時 `total=0`。
 * - 400 `{ error: "invalid_locale" | "invalid_date" }`；查詢逾時 503 `{ error: "timeout" }`。
 * - 讀 DB 的 GET：先 `await connection()`（Next 16.4 cacheComponents）。
 */
import { connection } from "next/server";
import { isValidIsoDate, parseFilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import type { IsoDate } from "../../domain/entities";
import { isCatalogQueryTimeoutError } from "../../domain/entities/read-errors";
import { getCalendarDay } from "../../use-cases/read";
import { filterSpecToReadQuery } from "../filter-mapping";
import { filterSpecForPage } from "../filters/filter-labels";
import { getTranslator } from "../labels";
import { parseMonthParam } from "../month";
import { toDayCard } from "./day-card";
import type { CalendarDayResponse } from "./types";

/** 單日回傳上限（保護回應大小；實際資料一天不會超過幾十款）。 */
export const CALENDAR_DAY_MAX_CARDS = 500;

/** 公開快取：瀏覽器 60 秒、CDN 5 分鐘（與月曆頁同一份資料來源，同步後最多落後這個時間）。 */
export const CALENDAR_DAY_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? CALENDAR_DAY_CACHE_CONTROL : "no-store", ...(status === 503 ? { "Retry-After": "30" } : {}) },
  });
}

export async function calendarDayResponse(request: Request): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const rawLocale = params.get("locale") ?? "";
  if (!isSupportedLocale(rawLocale, getLocaleConfig())) return json({ error: "invalid_locale" }, 400);
  const locale = rawLocale as Locale;
  const date = params.get("date") ?? "";
  if (!isValidIsoDate(date) || !parseMonthParam(date.slice(0, 7))) return json({ error: "invalid_date" }, 400);

  const rq = filterSpecToReadQuery(filterSpecForPage(parseFilterSpec(params).filter, "calendar"));
  if (!rq.show.releases) return json({ date, total: 0, cards: [] } satisfies CalendarDayResponse);
  try {
    const day = await getCalendarDay({ date: date as IsoDate, filter: rq.filter, regionPref: rq.regionPref, locale });
    const t = getTranslator(locale);
    const cards = day.cards.slice(0, CALENDAR_DAY_MAX_CARDS).map((c) => toDayCard(c, locale, t));
    return json({ date, total: cards.length, cards } satisfies CalendarDayResponse);
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) return json({ error: "timeout" }, 503);
    throw err;
  }
}
