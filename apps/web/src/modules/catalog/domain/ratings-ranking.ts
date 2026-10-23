/**
 * 評分排名頁的純邏輯（06 §評分排名、05）：欄位註冊、網址參數解析、名次差、FLIP 動畫要不要做的判斷。
 * 不碰 React／DB，方便單元測試。排序／門檻的 SQL 在 repository/ratings-ranking.ts。
 */
import {
  RATING_MIN_VOTES_MAX,
  RATING_RANK_DIRS,
  RATING_RANK_PAGE_MAX,
  type RatingColumn,
  type RatingRankDir,
} from "./entities";

/** IGDB 分數欄的預設最低票數：評分人數（aggregated_rating_count）至少 10 才列入。 */
export const IGDB_RANKING_MIN_VOTES = 10;

/** catalog 內建的欄位（永遠存在、永遠是第一欄與預設排序）。 */
export const IGDB_RATING_COLUMN: RatingColumn = {
  id: "igdb",
  scoreProvider: "igdb",
  scoreType: "critic_aggregate",
  labelKey: "ui.ratings.col.igdb",
  countLabelKey: "ui.ratings.count.critics",
  scale: "hundred",
  defaultMinVotes: () => IGDB_RANKING_MIN_VOTES,
};

export const DEFAULT_RATING_SORT = IGDB_RATING_COLUMN.id;

/** 內建欄位＋已註冊的可選欄位；id 重複時內建優先、先註冊的優先。 */
export function mergeRatingColumns(extra: readonly RatingColumn[]): RatingColumn[] {
  const out: RatingColumn[] = [IGDB_RATING_COLUMN];
  for (const c of extra) {
    if (!/^[a-z0-9]+$/.test(c.id) || out.some((o) => o.id === c.id)) continue;
    out.push(c);
  }
  return out;
}

export interface RatingsQueryParams {
  /** 排序欄 id（一定是 columns 裡有的）。 */
  sort: string;
  dir: RatingRankDir;
  /** 使用者給的最低票數；undefined＝用排序欄的預設。 */
  minVotes?: number;
  /** 前 page 頁（1~RATING_RANK_PAGE_MAX）。 */
  page: number;
  /** 前一個排序欄（用來算名次升降）；只在它是有效欄位且不同於 sort 時保留。 */
  prev?: string;
}

type RawParam = string | readonly string[] | undefined;
export type RatingsRawParams = Readonly<Record<string, RawParam>>;

function first(v: RawParam): string | undefined {
  return typeof v === "string" ? v : v?.[0];
}

/**
 * 解析 `sort`、`dir`、`minVotes`、`page`、`prev`。不 throw：
 * 未知／停用的欄位 → 預設欄；dir 只認 asc／desc；minVotes 要是 0~RATING_MIN_VOTES_MAX 的整數；page 夾在 1~RATING_RANK_PAGE_MAX。
 */
export function parseRatingsParams(raw: RatingsRawParams, columns: readonly RatingColumn[]): RatingsQueryParams {
  const ids = columns.map((c) => c.id);
  const sortRaw = first(raw.sort)?.trim().toLowerCase();
  const sort = sortRaw && ids.includes(sortRaw) ? sortRaw : DEFAULT_RATING_SORT;
  const dirRaw = first(raw.dir)?.trim().toLowerCase();
  const dir: RatingRankDir = (RATING_RANK_DIRS as readonly string[]).includes(dirRaw ?? "") ? (dirRaw as RatingRankDir) : "desc";
  const mv = first(raw.minVotes)?.trim();
  const minVotes = mv && /^\d{1,6}$/.test(mv) && Number(mv) <= RATING_MIN_VOTES_MAX ? Number(mv) : undefined;
  const pg = first(raw.page)?.trim();
  const page = pg && /^\d{1,3}$/.test(pg) ? Math.min(RATING_RANK_PAGE_MAX, Math.max(1, Number(pg))) : 1;
  const prevRaw = first(raw.prev)?.trim().toLowerCase();
  const prev = prevRaw && ids.includes(prevRaw) && prevRaw !== sort ? prevRaw : undefined;
  return { sort, dir, ...(minVotes !== undefined ? { minVotes } : {}), page, ...(prev ? { prev } : {}) };
}

/** 實際套用的最低票數。 */
export function effectiveMinVotes(column: RatingColumn, requested?: number): number {
  return requested ?? column.defaultMinVotes();
}

/** 名次差：正＝上升（名次數字變小）、負＝下降、0＝沒變；沒有前一個名次為 null。 */
export function rankDelta(prevRank: number | null | undefined, rank: number): number | null {
  if (prevRank == null || !Number.isFinite(prevRank)) return null;
  return prevRank - rank;
}

export type RankDeltaKind = "up" | "down" | "same" | "none";

export function rankDeltaKind(delta: number | null): RankDeltaKind {
  if (delta === null) return "none";
  return delta > 0 ? "up" : delta < 0 ? "down" : "same";
}

/**
 * 切換排序的位移動畫要不要對這一列做：舊位置或新位置有一個和視窗（上下各留 margin）相交才做；
 * 兩邊都在視窗外直接就位（列數多時省成本）。座標是 getBoundingClientRect 的 top／bottom。
 */
export function shouldAnimateRow(
  oldTop: number,
  oldBottom: number,
  newTop: number,
  newBottom: number,
  viewportHeight: number,
  margin = 0,
): boolean {
  const lo = -margin;
  const hi = viewportHeight + margin;
  const hits = (top: number, bottom: number) => bottom >= lo && top <= hi;
  return hits(oldTop, oldBottom) || hits(newTop, newBottom);
}
