import {
  BROWSE_OFFSET_MAX,
  BROWSE_PAGE_SIZE,
  BROWSE_PAGE_SIZE_MAX,
  BROWSE_SORTS,
  type BrowsePage,
  type BrowseSort,
  type ReleaseFilter,
} from "../../domain/entities";
import { tokenizeForSearch } from "../../domain/search-text";
import { resolveImageRef } from "../../providers/image-ref";
import { browseGameList } from "../../repository/browse";
import { utcToday } from "../../repository/release-aggregate";
import { resolveFilterSlugs } from "./resolve-filter";

export interface BrowseGamesInput {
  /** 遊戲層級維度：platform、platformKind、genre、theme、type、company、franchise、status、minHeat、rumored。stage 不適用。 */
  filter?: ReleaseFilter;
  /** 首發年份範圍（含）；filter-mapping 的 filterSpecToReadQuery 已處理 `year`。 */
  yearFrom?: number;
  yearTo?: number;
  /** 搜尋字串（原樣；這裡經 tokenizeForSearch）。 */
  q?: string | null;
  /** 預設 popularity。 */
  sort?: BrowseSort;
  /** 預設 0；超過 BROWSE_OFFSET_MAX 回空頁。 */
  offset?: number;
  /** 預設 BROWSE_PAGE_SIZE，上限 BROWSE_PAGE_SIZE_MAX。 */
  limit?: number;
  locale: string;
  now?: Date;
}

/**
 * 瀏覽／搜尋（06 §瀏覽與搜尋）。名稱排序依原文 games.name（UI 標示）。不開放依評分排序（D27）。
 * 未知 slug 忽略並回報；逾時丟 CatalogQueryTimeoutError。
 */
export async function browseGames(input: BrowseGamesInput): Promise<BrowsePage> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const sort: BrowseSort = input.sort && (BROWSE_SORTS as readonly string[]).includes(input.sort) ? input.sort : "popularity";
  const limit = clamp(input.limit, BROWSE_PAGE_SIZE, 1, BROWSE_PAGE_SIZE_MAX);
  const offset = clamp(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const searchTokens = input.q ? tokenizeForSearch(input.q).slice(0, 200) || null : null;
  let yearFrom = validYear(input.yearFrom);
  let yearTo = validYear(input.yearTo);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];

  if (offset > BROWSE_OFFSET_MAX) {
    return { games: [], sort, offset, limit, hasMore: false, searchTokens, ignored };
  }
  const res = await browseGameList({
    filter,
    yearFrom,
    yearTo,
    searchTokens,
    sort,
    offset,
    limit,
    locale: input.locale,
    today: utcToday(input.now),
    resolveImage: resolveImageRef,
  });
  return { games: res.games, sort, offset, limit, hasMore: res.hasMore, searchTokens, ignored };
}

function validYear(y: number | undefined): number | undefined {
  return y !== undefined && Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : undefined;
}

function clamp(v: number | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(v)));
}
