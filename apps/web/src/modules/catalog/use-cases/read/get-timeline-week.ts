import type { IgnoredFilterValue, IsoDate, ReleaseCard, ReleaseFilter } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { aggregateReleases } from "../../repository/release-aggregate";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface GetTimelineWeekInput {
  /** 這一週的第一天（星期一，`YYYY-MM-DD`；呼叫端已驗證）。 */
  start: IsoDate;
  /** 這一週的最後一天（星期日，含）。 */
  end: IsoDate;
  filter?: ReleaseFilter;
  /** regions.code；無效或未給 → DEFAULT_REGION_PREF。 */
  regionPref?: string | null;
  /** games.displayNames 的語系鍵（zh-Hant、en、ja）。 */
  locale: string;
}

export interface TimelineWeekDay {
  date: IsoDate;
  /** 當日（day 精度）所有卡片，順序與月曆同一天相同（熱度高到低，同分依名稱）。 */
  cards: ReleaseCard[];
}

export interface TimelineWeek {
  /** 只含有遊戲上市的日子，依日期由早到晚。 */
  days: TimelineWeekDay[];
  ignored: IgnoredFilterValue[];
}

/**
 * 時間軸一週（06 §時間軸）：週內 day 精度的上市，依日期分組。
 * 聚合規則唯一實作在 aggregateReleases（與月曆共用）；月／季／年精度與 tbd 不屬於任何一天，這裡不回傳（月曆有「本月未定日」）。
 */
export async function getTimelineWeek(input: GetTimelineWeekInput): Promise<TimelineWeek> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const regionPref = resolveRegionPref(input.regionPref);
  const cards = await aggregateReleases({
    from: input.start,
    to: input.end,
    filter,
    regionPref,
    locale: input.locale,
    resolveImage: resolveImageRef,
  });
  const byDate = new Map<IsoDate, ReleaseCard[]>();
  for (const c of cards) {
    if (c.precision !== "day" || !c.date) continue;
    const list = byDate.get(c.date);
    if (list) list.push(c);
    else byDate.set(c.date, [c]);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, cards: list }));
  return { days, ignored };
}
