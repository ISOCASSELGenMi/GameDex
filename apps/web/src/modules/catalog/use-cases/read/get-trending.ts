import { SITE_FOLLOWS_7D_SIGNAL, type IgnoredFilterValue, type PopularityGroup, type ReleaseFilter, type TrendingFilter, type TrendingPage } from "../../domain/entities";
import { hasPopularitySignal } from "../../extensions";
import { resolveImageRef } from "../../providers/image-ref";
import { listTrending, TRENDING_MAX_LIMIT } from "../../repository/trending";
import { resolveFilterSlugs } from "./resolve-filter";

export const TRENDING_DEFAULT_LIMIT = 50;
export { TRENDING_MAX_LIMIT };

export interface GetTrendingInput {
  /** 預設 upcoming（未上市或上市 ≤ 30 天）。 */
  group?: PopularityGroup;
  /** 只用 platformSlugs、platformKinds、genreSlugs、gameTypes、includeRumored；stage／status 對熱門榜無意義、忽略。 */
  filter?: ReleaseFilter;
  locale: string;
  /** 1~100，預設 50。 */
  limit?: number;
  /** ≥ 0，預設 0。 */
  offset?: number;
  /** 排序依據；預設：accounts 啟用（有 site_follows_7d 提供者）→ site_follows_7d，否則 popularity。 */
  rankBy?: "popularity" | "site_follows_7d";
  /** 分群用的「今天」（UTC `YYYY-MM-DD`）；預設現在的 UTC 日期。 */
  today?: string;
}

/**
 * 熱門榜（06 §熱度顯示）：accounts 停用時依 popularityScore 由高到低。未知篩選值忽略並回報（同月曆）。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getTrending(input: GetTrendingInput): Promise<TrendingPage & { ignored: IgnoredFilterValue[] }> {
  const rankedBy = input.rankBy ?? (hasPopularitySignal(SITE_FOLLOWS_7D_SIGNAL) ? "site_follows_7d" : "popularity");
  const group: PopularityGroup = input.group === "released" ? "released" : "upcoming";
  const limit = Math.min(TRENDING_MAX_LIMIT, Math.max(1, finiteInt(input.limit, TRENDING_DEFAULT_LIMIT)));
  const offset = Math.max(0, finiteInt(input.offset, 0));
  const { filter: resolved, ignored } = await resolveFilterSlugs(input.filter);
  const filter: TrendingFilter = {
    ...(resolved.platformIds ? { platformIds: resolved.platformIds } : {}),
    ...(resolved.platformKinds ? { platformKinds: resolved.platformKinds } : {}),
    ...(resolved.genreIds ? { genreIds: resolved.genreIds } : {}),
    gameTypes: resolved.gameTypes,
    includeRumored: resolved.includeRumored,
  };
  const { items, hasMore } = await listTrending({
    group,
    todayUtc: input.today ?? new Date().toISOString().slice(0, 10),
    filter,
    locale: input.locale,
    limit,
    offset,
    resolveImage: resolveImageRef,
    rankBySiteFollows7d: rankedBy === "site_follows_7d",
  });
  return { group, items, limit, offset, hasMore, rankedBy, ignored };
}

const finiteInt = (v: number | undefined, fallback: number) => (v != null && Number.isFinite(v) ? Math.floor(v) : fallback);
