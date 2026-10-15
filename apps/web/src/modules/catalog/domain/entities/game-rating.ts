import type { ScoreProvider } from "./enums";

/** 詳情頁讀取的一列分數（只含有分數的列；score=NULL 的負向快取列在 Repository 就濾掉）。 */
export interface GameRating {
  scoreProvider: ScoreProvider;
  /** `critic_aggregate`｜`metascore`｜`user_score`。 */
  scoreType: string;
  score: number;
  /** 一律 100（05：正規化到 0~100）。 */
  scoreMax: number;
  reviewCount: number | null;
  /** NULL＝來源不分平台。 */
  platformId: number | null;
  sourceUrl: string | null;
}
