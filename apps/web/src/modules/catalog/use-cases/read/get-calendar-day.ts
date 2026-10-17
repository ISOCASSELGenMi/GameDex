import type { IgnoredFilterValue, IsoDate, ReleaseCard, ReleaseFilter } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { aggregateReleases } from "../../repository/release-aggregate";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface GetCalendarDayInput {
  /** `YYYY-MM-DD`（呼叫端已驗證格式）。 */
  date: IsoDate;
  filter?: ReleaseFilter;
  /** regions.code；無效或未給 → DEFAULT_REGION_PREF。 */
  regionPref?: string | null;
  /** games.displayNames 的語系鍵（zh-Hant、en、ja）。 */
  locale: string;
}

export interface CalendarDay {
  date: IsoDate;
  /** 當日（day 精度）所有卡片，順序與月曆頁同一天的順序相同（熱度高到低，同分依名稱）。 */
  cards: ReleaseCard[];
  ignored: IgnoredFilterValue[];
}

/**
 * 月曆某一天的全部遊戲卡片（月曆格內左右切換時按需載入）。
 * 聚合規則唯一實作在 aggregateReleases（與 getCalendarMonth 共用），這裡只取 day 精度的卡片：
 * 月／季／年精度的代表日可能恰好落在同一天，但月曆把它們放在「本月未定日」，不屬於這一格。
 */
export async function getCalendarDay(input: GetCalendarDayInput): Promise<CalendarDay> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const regionPref = resolveRegionPref(input.regionPref);
  const cards = await aggregateReleases({
    from: input.date,
    to: input.date,
    filter,
    regionPref,
    locale: input.locale,
    resolveImage: resolveImageRef,
  });
  return { date: input.date, cards: cards.filter((c) => c.precision === "day" && c.date === input.date), ignored };
}
