// 我方的 enum 值（Domain，零外部依賴）。schema.ts 以這些陣列建立 pgEnum，確保單一來源。

export const DATE_PRECISIONS = ["day", "month", "quarter", "year", "tbd"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const RELEASE_STATUSES = ["scheduled", "delayed", "released", "cancelled"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** 「來源還有沒有這筆」，不等於取消（D7）。 */
export const SOURCE_STATUSES = ["active", "removed"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** 未知一律 unspecified，不預設 full。 */
export const RELEASE_STAGES = ["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"] as const;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export const PLATFORM_KINDS = ["console", "handheld", "hybrid", "pc", "arcade", "mobile", "other"] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

export const PLATFORM_STATUSES = ["announced", "active", "discontinued"] as const;
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number];

export const SCORE_PROVIDERS = ["igdb", "opencritic", "metacritic_scrape"] as const;
export type ScoreProvider = (typeof SCORE_PROVIDERS)[number];

export const GAME_COMPANY_ROLES = ["developer", "publisher", "porting", "supporting"] as const;
export type GameCompanyRole = (typeof GAME_COMPANY_ROLES)[number];

/** IGDB 的 franchise 與 collection 是不同 id 空間。 */
export const FRANCHISE_KINDS = ["franchise", "collection"] as const;
export type FranchiseKind = (typeof FRANCHISE_KINDS)[number];

export const GAME_LINK_TYPES = ["store", "official", "social", "media"] as const;
export type GameLinkType = (typeof GAME_LINK_TYPES)[number];

export const EVENT_KINDS = ["showcase", "expo", "awards", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const LANGUAGE_SUPPORT_TYPES = ["interface", "subtitles", "audio"] as const;
export type LanguageSupportType = (typeof LANGUAGE_SUPPORT_TYPES)[number];

/** source 欄位：同步只動 igdb 列，不覆蓋、不刪除 manual 列（03 §通用規則）。 */
export type DataSource = "igdb" | "manual";

/** `YYYY-MM-DD`；資料庫 date 欄位以字串往返，避免時區位移。 */
export type IsoDate = string;

/** games.gameType（04 §遊戲類型）。月曆等預設只顯示 CALENDAR_VISIBLE_GAME_TYPES，其餘照存。 */
export const GAME_TYPES = [
  "main_game", "dlc_addon", "expansion", "bundle", "standalone_expansion", "mod", "episode", "season",
  "remake", "remaster", "expanded_game", "port", "fork", "pack", "update", "other",
] as const;
export type GameType = (typeof GAME_TYPES)[number];

/** games.gameStatus（04 §遊戲層級狀態）；NULL＝一般狀態。 */
export const GAME_STATUSES = [
  "released", "alpha", "beta", "early_access", "offline", "cancelled", "rumored", "delisted",
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];
