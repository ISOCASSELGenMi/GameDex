import type { DatePrecision, IgnoredFilterValue, IsoDate, ReleaseCard, ReleaseFilter } from "../../domain/entities";
import { aggregateReleases } from "../../repository/release-aggregate";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface ListReleaseCardsInput {
  /** 代表日期下限／上限（含）；未給＝不限。 */
  from?: IsoDate | null;
  to?: IsoDate | null;
  /** 預設 day、month、quarter、year；要 tbd 須明確列入。 */
  precisions?: readonly DatePrecision[];
  filter?: ReleaseFilter;
  regionPref?: string | null;
  locale: string;
  limit?: number;
}

/**
 * 套用聚合規則的通用清單（時間軸、Discord `/upcoming`、公開 iCal 之後共用；月曆用 getCalendarMonth）。
 * 排序：代表日期 → 精度 → 熱度 → 名稱。逾時丟 CatalogQueryTimeoutError。
 */
export async function listReleaseCards(input: ListReleaseCardsInput): Promise<{ cards: ReleaseCard[]; ignored: IgnoredFilterValue[] }> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const cards = await aggregateReleases({
    from: input.from,
    to: input.to,
    precisions: input.precisions,
    filter,
    regionPref: resolveRegionPref(input.regionPref),
    locale: input.locale,
    limit: input.limit,
  });
  return { cards, ignored };
}
