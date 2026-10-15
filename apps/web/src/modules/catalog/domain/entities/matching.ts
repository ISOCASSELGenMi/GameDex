/** 標題比對（05 §標題比對）：外部來源的候選與比對結果。純型別。 */

/** 外部來源的一筆候選遊戲（Metacritic、Steam、Xbox…搜尋結果轉成我方型別後的樣子）。 */
export interface Candidate {
  /** 該來源的 ID（Metacritic 為 slug 等）。 */
  externalId: string;
  name: string;
  /** 上市年份；未知為 null。 */
  releaseYear: number | null;
  /** 候選的平台鍵（與 findBestMatch 的 platforms 用同一套鍵，例如 igdb 平台 slug）；選用。 */
  platforms?: readonly string[];
  externalUrl?: string | null;
}

export interface MatchResult {
  externalId: string;
  name: string;
  externalUrl: string | null;
  /** 0~100，已含年份加減、子集上限、平台加分。 */
  confidencePct: number;
  /** 60~84，或 ≥85 但最佳與次佳差距 < 5。 */
  needsReview: boolean;
}
