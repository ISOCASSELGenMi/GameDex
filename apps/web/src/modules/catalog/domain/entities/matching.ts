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

/** 我方遊戲用來驗證外部頁面的資料（名稱、所有平台／地區的日精度日期、開發／發行商名稱、平台名稱）。 */
export interface OurGameFacts {
  /** name + alternative names。 */
  names: readonly string[];
  /** YYYY-MM-DD；只含日精度，各平台各地區的日期都列入（同一款遊戲各平台上架日可能不同）。 */
  dates: readonly string[];
  companies: readonly string[];
  platforms: readonly string[];
  /** 我方的 Steam AppID（external_ids source='steam'）；用來向 Steam 查它記錄的 Metacritic 頁面當佐證。 */
  steamAppId?: string | null;
}

/** 第三方（Steam）對「這款遊戲在外部來源的哪一頁」的說法，用來佐證或否定候選。 */
export interface ExternalHint {
  /** Steam 記錄的 Metacritic slug；Steam 沒有記錄（或查不到）為 null／undefined＝未知，不影響判斷。 */
  steamSlug: string | null | undefined;
  /** 正在驗證的候選 slug。 */
  candidateSlug: string;
}

/** 外部遊戲頁上的資料（Provider 層轉成我方型別後的樣子）。 */
export interface ExternalFacts {
  title: string | null;
  /** YYYY-MM-DD；頁面上的首次上市日。 */
  releaseDate: string | null;
  /** 開發商與發行商名稱。 */
  companies: readonly string[];
  platforms: readonly string[];
}

export interface VerifyVerdict {
  decision: "adopt" | "review" | "reject";
  confidencePct: number;
  reasons: string[];
}
