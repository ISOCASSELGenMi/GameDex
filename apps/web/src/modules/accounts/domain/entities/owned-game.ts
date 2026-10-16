/**
 * 遊戲庫匯入（09 §遊戲庫匯入、03 owned_games）：我方型別。外部格式（Steam 的 appid、playtime_forever…）只存在 Provider 層。
 */

/** 目前支援匯入的平台（路徑 `/api/v1/imports/{provider}`）。Xbox 為第 4 波。 */
export const IMPORT_PROVIDERS = ["steam"] as const;
export type ImportProvider = (typeof IMPORT_PROVIDERS)[number];
export function isImportProvider(value: string): value is ImportProvider {
  return (IMPORT_PROVIDERS as readonly string[]).includes(value);
}

/** 匯入來源對應 catalog `external_ids.source`。 */
export const EXTERNAL_ID_SOURCE: Record<ImportProvider, string> = { steam: "steam" };

/** 同一個 connected account 兩次匯入的最短間隔。 */
export const IMPORT_COOLDOWN_MS = 10 * 60_000;

/** 每次排程比對處理的上限列數。 */
export const MATCH_BATCH_SIZE = 500;

/** 平台回傳的一筆擁有遊戲（已轉成我方型別）。 */
export interface ExternalOwnedGame {
  externalGameId: string;
  title: string;
}

/**
 * 比對狀態：
 * - queued：尚未比對（matchConfidencePct IS NULL）
 * - matched：已對到遊戲
 * - needs_review：比對過但信心不足（寫入信心、matchedGameId 為 NULL；不自動採用）
 * - not_found：比對過但沒有候選（信心 0）
 */
export const OWNED_GAME_STATUSES = ["queued", "matched", "needs_review", "not_found"] as const;
export type OwnedGameStatus = (typeof OWNED_GAME_STATUSES)[number];

export function ownedGameStatus(row: { matchedGameId: number | null; matchConfidencePct: number | null }): OwnedGameStatus {
  if (row.matchConfidencePct === null) return "queued";
  if (row.matchedGameId !== null) return "matched";
  return row.matchConfidencePct > 0 ? "needs_review" : "not_found";
}

/** 一筆比對結果（寫回 owned_games）。matchedGameId 為 null 時 confidencePct：0＝沒有候選、>0＝待確認。 */
export interface OwnedGameMatch {
  ownedGameId: number;
  matchedGameId: number | null;
  confidencePct: number;
}

export interface OwnedGamesSummary {
  total: number;
  matched: number;
  needsReview: number;
  notFound: number;
  queued: number;
  /** 最後一次匯入時間（ISO）；從未匯入為 null。 */
  lastImportedAt: string | null;
}

export interface OwnedGameView {
  id: number;
  externalGameId: string;
  title: string;
  status: OwnedGameStatus;
  confidencePct: number | null;
  /** 已對到的遊戲；其他狀態為 null。 */
  game: { slug: string; name: string } | null;
}

export interface OwnedGamesPage {
  summary: OwnedGamesSummary;
  items: OwnedGameView[];
  /** 這一頁之後還有沒有。 */
  hasMore: boolean;
}

/** 匯入／查詢的錯誤碼（API 回應的 code；UI 依此顯示文案）。 */
export const IMPORT_ERROR_CODES = [
  "steam_not_linked",
  "steam_import_unavailable",
  "steam_profile_private",
  "steam_upstream_error",
  "import_cooldown",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
