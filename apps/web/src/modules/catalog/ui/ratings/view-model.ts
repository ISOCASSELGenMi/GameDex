/**
 * 評分排名頁 `/ratings` 的純邏輯（view-model）：網址組裝、排序切換、client 用的列資料。不碰 React／DB，方便單元測試。
 */
import type { RatingCell, RatingColumn, RatingRankDir, RatingRankRow, RatingsRanking } from "../../domain/entities";
import { gameNameLang } from "../name-lang";
import { DEFAULT_RATING_SORT, rankDelta, rankDeltaKind, type RankDeltaKind } from "../../domain/ratings-ranking";

/** 傳給 client 元件／API 回應的一列（只含畫面需要的欄位，連結由 client 用 gameBase 組）。 */
export interface RatingsClientRow {
  id: number;
  slug: string;
  name: string;
  /** 名稱元素的 lang 屬性（顯示原名且語言與頁面不同時才有）。 */
  lang?: string;
  /** 封面小圖網址（沒有封面為 null）。 */
  cover: string | null;
  year: number | null;
  rank: number;
  prevRank: number | null;
  cells: Record<string, RatingCell>;
}

export interface RatingsClientColumn {
  id: string;
  label: string;
  /** 人數說明樣板（含 `{count}`）。 */
  countLabel: string;
  scale: RatingColumn["scale"];
}

/** GET /api/v1/ratings/ranking 的回應，也是頁面第一頁的初始資料。 */
export interface RatingsRankingResponse {
  sort: string;
  dir: RatingRankDir;
  /** 實際套用的最低票數。 */
  minVotes: number;
  defaultMinVotes: number;
  total: number;
  /** 目前涵蓋到第幾頁（累計模式＝請求的 page；chunk 模式＝該頁）。 */
  page: number;
  hasMore: boolean;
  rows: RatingsClientRow[];
}

export function toClientRow(r: RatingRankRow, locale: string): RatingsClientRow {
  const lang = gameNameLang(r.name, r.name === r.originalName, locale);
  return {
    id: r.gameId,
    slug: r.slug,
    name: r.name,
    ...(lang ? { lang } : {}),
    cover: r.cover?.small ?? null,
    year: r.year,
    rank: r.rank,
    prevRank: r.prevRank,
    cells: r.cells,
  };
}

export function toRankingResponse(r: RatingsRanking, page: number, locale: string): RatingsRankingResponse {
  return {
    sort: r.sort,
    dir: r.dir,
    minVotes: r.minVotes,
    defaultMinVotes: r.defaultMinVotes,
    total: r.total,
    page,
    hasMore: r.hasMore,
    rows: r.rows.map((row) => toClientRow(row, locale)),
  };
}

/**
 * 點欄位標題後的新排序：同一欄 → 切換升降冪；換欄 → 降冪（分數高的在前）。
 */
export function nextSort(current: { sort: string; dir: RatingRankDir }, clicked: string): { sort: string; dir: RatingRankDir } {
  if (current.sort === clicked) return { sort: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
  return { sort: clicked, dir: "desc" };
}

export function ariaSortValue(columnId: string, sort: string, dir: RatingRankDir): "ascending" | "descending" | undefined {
  if (columnId !== sort) return undefined;
  return dir === "asc" ? "ascending" : "descending";
}

export interface RatingsUrlState {
  /** 篩選的正規 query（filterSpecToQueryString），不含 `?`。 */
  filterQuery: string;
  /** undefined＝網址不帶 sort／dir。 */
  sort?: string;
  dir?: RatingRankDir;
  /** 使用者明確指定的最低票數；undefined＝用預設，不寫進網址。 */
  minVotes?: number;
  page?: number;
}

/** 網址的 query（不含 `?`）：篩選在前，其後 sort、dir、minVotes、page（固定順序）。 */
export function ratingsQuery(s: RatingsUrlState): string {
  const parts: string[] = [];
  if (s.filterQuery) parts.push(s.filterQuery);
  if (s.sort) parts.push(`sort=${encodeURIComponent(s.sort)}`);
  if (s.dir) parts.push(`dir=${s.dir}`);
  if (s.minVotes !== undefined) parts.push(`minVotes=${s.minVotes}`);
  if (s.page && s.page > 1) parts.push(`page=${s.page}`);
  return parts.join("&");
}

/** 欄位 id 是不是內建預設欄。 */
export function isDefaultSort(sort: string): boolean {
  return sort === DEFAULT_RATING_SORT;
}

export interface RankMark {
  kind: RankDeltaKind;
  /** 名次變動的絕對值（0 與 none 為 0）。 */
  amount: number;
}

/** 這一列的名次升降標示（沒有前一個名次 → none）。 */
export function rankMark(row: Pick<RatingsClientRow, "rank" | "prevRank">): RankMark {
  const d = rankDelta(row.prevRank, row.rank);
  return { kind: rankDeltaKind(d), amount: d === null ? 0 : Math.abs(d) };
}
