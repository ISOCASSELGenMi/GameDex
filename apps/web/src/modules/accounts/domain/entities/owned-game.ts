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
 * - not_found：比對過但沒有候選（信心 0）；每次匯入會被重設回 queued 重新比對（catalog 之後可能新增對應遊戲）。needs_review、matched 不重設
 * - dismissed：使用者手動否決（第 5 波）；不重設、不重比
 */
export const OWNED_GAME_STATUSES = ["queued", "matched", "needs_review", "not_found", "dismissed"] as const;
export type OwnedGameStatus = (typeof OWNED_GAME_STATUSES)[number];

/** 比對方式（owned_games.match_method）：auto＝程式比對；manual＝使用者手動指定／否決（第 5 波；匯入重比與排程比對都不碰 manual 列）。 */
export const MATCH_METHODS = ["auto", "manual"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];
export function asMatchMethod(v: string | null | undefined): MatchMethod {
  return v === "manual" ? "manual" : "auto";
}

/**
 * 比對狀態唯一判定。
 * - dismissed：使用者手動否決（match_method='manual'、matchedGameId NULL、信心 0）＝「這不是 catalog 裡的任何遊戲」。不重比、不算「找不到」。
 * - 手動指定（manual、matchedGameId 非 NULL、信心 100）＝ matched。
 * - 手動指定的遊戲後來被刪（FK SET NULL → manual、matchedGameId NULL、信心 100）＝ needs_review（請使用者重新指定）。
 */
export function ownedGameStatus(row: {
  matchedGameId: number | null;
  matchConfidencePct: number | null;
  matchMethod?: string | null;
}): OwnedGameStatus {
  if (row.matchConfidencePct === null) return "queued";
  if (row.matchedGameId !== null) return "matched";
  if (row.matchConfidencePct === 0) return asMatchMethod(row.matchMethod) === "manual" ? "dismissed" : "not_found";
  return "needs_review";
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
  /** 自動比對過但沒有候選（手動否決的不算在內）。 */
  notFound: number;
  /** 使用者手動否決（不是 catalog 的任何遊戲）。 */
  dismissed: number;
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
  matchMethod: MatchMethod;
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

/** 手動指定比對（第 5 波）的錯誤碼。 */
export const MANUAL_MATCH_ERROR_CODES = ["owned_game_not_found", "game_not_found", "validation_failed"] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
