import type { CalendarMonth, DatePrecision, ReleaseCard, ReleaseFilter } from "../../domain/entities";
import { monthBounds } from "../../domain/release-filter";
import { listEventsInRange } from "../../repository/calendar-events";
import { resolveImageRef } from "../../providers/image-ref";
import { aggregateReleases } from "../../repository/release-aggregate";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface GetCalendarMonthInput {
  year: number;
  /** 1~12 */
  month: number;
  filter?: ReleaseFilter;
  /** regions.code；無效或未給 → DEFAULT_REGION_PREF。 */
  regionPref?: string | null;
  /** games.displayNames 的語系鍵（zh-Hant、en、ja）。 */
  locale: string;
  /** 是否查活動（`show=releases,events`）；預設 true。 */
  includeEvents?: boolean;
}

const PRECISION_RANK: Record<DatePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

/**
 * 月曆一個月（06 §月曆）：
 * - 精度 day → `days`（依日期分組，每天依熱度高到低）
 * - 月精度（代表日＝當月 1 日）、季／年精度（代表日＝期間最後一天，落在期間最後一個月）→ `undated`
 * - tbd 不出現。
 * 年月無效丟 RangeError；查詢逾時丟 CatalogQueryTimeoutError（UI 回 503）。
 */
export async function getCalendarMonth(input: GetCalendarMonthInput): Promise<CalendarMonth> {
  const { first, last } = monthBounds(input.year, input.month);
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const regionPref = resolveRegionPref(input.regionPref);

  const monthStart = new Date(`${first}T00:00:00Z`);
  const nextMonthStart = new Date(Date.UTC(input.year, input.month, 1));

  const [cards, events] = await Promise.all([
    aggregateReleases({ from: first, to: last, filter, regionPref, locale: input.locale, resolveImage: resolveImageRef }),
    input.includeEvents === false ? Promise.resolve([]) : listEventsInRange({ from: monthStart, to: nextMonthStart }),
  ]);

  const days: Record<string, ReleaseCard[]> = {};
  const undated: ReleaseCard[] = [];
  for (const c of cards) {
    if (c.precision === "day" && c.date) (days[c.date] ??= []).push(c);
    else if (c.precision !== "tbd") undated.push(c);
  }
  // aggregateReleases 已依日期 → 熱度 → 名稱排序；undated 改依精度 → 熱度 → 名稱
  undated.sort(
    (a, b) =>
      PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision] ||
      b.popularityScore - a.popularityScore ||
      a.name.localeCompare(b.name) ||
      a.gameId - b.gameId,
  );
  return { year: input.year, month: input.month, days, undated, events, ignored };
}
