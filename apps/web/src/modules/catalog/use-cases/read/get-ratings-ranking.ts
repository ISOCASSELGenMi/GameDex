import {
  RATING_RANK_PAGE_MAX,
  RATING_RANK_PAGE_SIZE,
  type RatingColumn,
  type RatingRankDir,
  type RatingsRanking,
  type ReleaseFilter,
} from "../../domain/entities";
import { DEFAULT_RATING_SORT, effectiveMinVotes, mergeRatingColumns } from "../../domain/ratings-ranking";
import { getCatalogExtensions } from "../../extensions";
import { getEffectiveRatingDisplayConfig } from "./rating-config";
import { resolveImageRef } from "../../providers/image-ref";
import { listRatingsRanking } from "../../repository/ratings-ranking";
import { utcToday } from "../../repository/release-aggregate";
import { resolveFilterSlugs } from "./resolve-filter";

/** 目前註冊的分數欄：內建 igdb＋已啟用模組註冊的欄位（catalog 不知道有哪些模組）。不含後台設定的隱藏。 */
export function getRatingColumns(): RatingColumn[] {
  return mergeRatingColumns(getCatalogExtensions().ratingColumns);
}

/**
 * 實際顯示的分數欄：再去掉後台關掉的分數類型（Metascore、Userscore 開關）。
 * 內建 igdb 欄（預設排序欄）永遠保留；排名頁是排名工具，不套「可見來源」（VISIBLE_SCORE_PROVIDERS 只管詳情頁的分數區）。
 */
export async function getEffectiveRatingColumns(): Promise<RatingColumn[]> {
  const cfg = await getEffectiveRatingDisplayConfig();
  return getRatingColumns().filter((c) => c.id === DEFAULT_RATING_SORT || !cfg.hiddenScoreTypes.includes(c.scoreType));
}

export interface GetRatingsRankingInput {
  /** 篩選（遊戲層級維度，同瀏覽頁）。 */
  filter?: ReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  /** 排序欄 id；未知或已停用 → 預設欄（igdb）。 */
  sort?: string;
  dir?: RatingRankDir;
  /** 排序欄的最低票數；省略＝該欄預設。 */
  minVotes?: number;
  /** 前一個排序欄 id（算名次升降）；與 sort 相同或無效則忽略。 */
  prev?: string;
  /** 1 起算。`cumulative`＝true（預設）回傳前 page 頁；false 只回第 page 頁（「載入更多」用）。 */
  page?: number;
  cumulative?: boolean;
  locale: string;
  now?: Date;
}

/**
 * 評分排名頁／API 的唯一入口。未知 slug 忽略並回報；逾時丟 CatalogQueryTimeoutError。
 * prev 欄用它自己的預設最低票數（不跟著使用者調的門檻，那是排序欄的設定）。
 */
export async function getRatingsRanking(input: GetRatingsRankingInput): Promise<RatingsRanking> {
  const columns = await getEffectiveRatingColumns();
  const sort = columns.find((c) => c.id === input.sort) ?? columns.find((c) => c.id === DEFAULT_RATING_SORT)!;
  const prevCol = input.prev && input.prev !== sort.id ? columns.find((c) => c.id === input.prev) : undefined;
  const dir: RatingRankDir = input.dir === "asc" ? "asc" : "desc";
  const defaultMinVotes = sort.defaultMinVotes();
  const minVotes = effectiveMinVotes(sort, input.minVotes);
  const page = Math.min(RATING_RANK_PAGE_MAX, Math.max(1, Math.floor(input.page ?? 1)));
  const cumulative = input.cumulative !== false;
  const offset = cumulative ? 0 : (page - 1) * RATING_RANK_PAGE_SIZE;
  const limit = cumulative ? page * RATING_RANK_PAGE_SIZE : RATING_RANK_PAGE_SIZE;

  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  let yearFrom = input.yearFrom;
  let yearTo = input.yearTo;
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  const res = await listRatingsRanking({
    filter,
    yearFrom,
    yearTo,
    today: utcToday(input.now),
    sort,
    minVotes,
    dir,
    ...(prevCol ? { prev: { column: prevCol, minVotes: prevCol.defaultMinVotes() } } : {}),
    columns,
    offset,
    limit,
    locale: input.locale,
    resolveImage: resolveImageRef,
  });
  return {
    sort: sort.id,
    dir,
    minVotes,
    defaultMinVotes,
    columns,
    offset,
    rows: res.rows,
    total: res.total,
    hasMore: offset + res.rows.length < res.total && page < RATING_RANK_PAGE_MAX,
    ignored,
  };
}
