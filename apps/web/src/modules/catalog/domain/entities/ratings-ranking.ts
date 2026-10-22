// 評分排名頁（/ratings）的型別與常數。Domain 型別，零外部依賴。
import type { ImageRef } from "./image-ref";
import type { IgnoredFilterValue } from "./read-models";

/** 一頁（或一次「載入更多」）的列數。 */
export const RATING_RANK_PAGE_SIZE = 50;
/** SSR 一次最多顯示幾頁（`?page=n` 代表前 n 頁，沒有 JS 時的「載入更多」就是 page+1）。 */
export const RATING_RANK_PAGE_MAX = 20;
/** 最低票數門檻的合法範圍。 */
export const RATING_MIN_VOTES_MAX = 100000;

export const RATING_RANK_DIRS = ["desc", "asc"] as const;
export type RatingRankDir = (typeof RATING_RANK_DIRS)[number];

/** 分數顯示：hundred＝0~100 整數（IGDB）；ten＝÷10 一位小數（玩家平均 8.5）。 */
export type RatingDisplayScale = "hundred" | "ten";

/**
 * 排名表的一個分數欄位。ratings 表的 (scoreProvider, scoreType, platformId=NULL) 對應一欄。
 * catalog 內建 `igdb`；可選模組經 manifest 的 `ratingColumns` 註冊額外欄位（accounts 的 `players`、日後 metacritic 的 `metascore`／`userscore`），
 * 沒註冊（模組停用）時該欄不出現、`sort=<id>` 退回預設欄。catalog 不寫死任何可選模組的名稱。
 */
export interface RatingColumn {
  /** 網址 `sort` 參數值與欄位識別；小寫英數。 */
  readonly id: string;
  readonly scoreProvider: string;
  readonly scoreType: string;
  /** 欄位標題的字典 key（例如 `ui.ratings.col.igdb`）。 */
  readonly labelKey: string;
  /** 人數說明的字典 key，含 `{count}`（例如 `ui.ratings.count.critics`＝「{count} 則評論」）。 */
  readonly countLabelKey: string;
  readonly scale: RatingDisplayScale;
  /** 排序依這欄時的預設最低票數；呼叫時才取值（可讀環境變數）。 */
  defaultMinVotes(): number;
}

/** 排名表的一欄分數（沒有該來源的分數 → score 為 null）。 */
export interface RatingCell {
  score: number | null;
  /** 評論／評分人數。 */
  count: number | null;
}

export interface RatingRankRow {
  gameId: number;
  slug: string;
  name: string;
  originalName: string;
  cover: ImageRef | null;
  year: number | null;
  /** 名次（依排序欄的分數由高到低；同分同名次）。與 dir 無關：1 永遠是分數最高者。 */
  rank: number;
  /** 上一個排序欄位的名次；沒有指定前一欄、或這款不在前一欄的排名內為 null。 */
  prevRank: number | null;
  /** 欄位 id → 分數。 */
  cells: Record<string, RatingCell>;
}

export interface RatingsRanking {
  sort: string;
  dir: RatingRankDir;
  /** 實際套用的最低票數（使用者給的，或排序欄的預設）。 */
  minVotes: number;
  /** 排序欄的預設最低票數（UI 顯示「預設 10」）。 */
  defaultMinVotes: number;
  /** 本次查詢可用的欄位（含已註冊的可選欄位）。 */
  columns: RatingColumn[];
  offset: number;
  rows: RatingRankRow[];
  /** 符合條件（含票數門檻）的總款數。 */
  total: number;
  hasMore: boolean;
  /** 被忽略的篩選值（未知 slug）。 */
  ignored: IgnoredFilterValue[];
}
