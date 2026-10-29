import type {
  FranchiseKind,
  GameCompanyRole,
  GameLinkType,
  GameStatus,
  GameType,
  LanguageSupportType,
  ReleaseStage,
} from "./enums";
import type { ReleaseDateSpan } from "./platform";

/**
 * GameDataProvider.fetchGames() 的回傳（04 §資料來源介面）：一款遊戲的完整聚合，來源格式已在 Provider 轉完。
 * 關聯實體（平台、公司…）以來源 id 參照，由同步 Use Case 對應成我方 id。
 */
export interface GameRecord {
  igdbId: number;
  name: string;
  slug: string;
  summary: string | null;
  coverUrl: string | null;
  gameType: GameType;
  gameStatus: GameStatus | null;
  /** 本體遊戲的來源 id（DLC／重製）；本體可能尚未同步。 */
  parentIgdbId: number | null;
  alternativeNames: { name: string; comment: string | null }[];
  /** 前 6 張。 */
  screenshotUrls: string[];
  /** 第一支影片。 */
  trailerUrl: string | null;
  /** 只有 aggregated_rating_count > 0 才有值（05：0 不是分數）。 */
  criticScore: { score: number; reviewCount: number } | null;
  /** 來源的最後更新時間；寫進 release_events.sourceUpdatedAt。 */
  sourceUpdatedAt: Date | null;
  platformIgdbIds: number[];
  releaseDates: GameReleaseDateRecord[];
  genres: TaxonomyRecord[];
  themes: TaxonomyRecord[];
  companies: GameCompanyRecord[];
  franchises: FranchiseRecord[];
  localizations: GameLocalizationRecord[];
  languageSupports: GameLanguageSupportRecord[];
  /** 已依 (categoryLabel) 去重，websites 優先（04 §外部連結）。 */
  links: GameLinkRecord[];
  /** Steam AppID（external_games.uid）；寫進 external_ids。 */
  steamAppId: string | null;
  similarIgdbIds: number[];
  /** IGDB storyline（英文原文）。 */
  storyline: string | null;
  /** 本作是哪一款的版本（version_parent，來源 id）；本體可能尚未同步。 */
  versionParentIgdbId: number | null;
  /** version_title（例如 "Nintendo Switch 2 Edition"）。 */
  versionTitle: string | null;
  gameModes: TaxonomyRecord[];
  playerPerspectives: TaxonomyRecord[];
  engines: TaxonomyRecord[];
}

export interface GameReleaseDateRecord extends ReleaseDateSpan {
  platformIgdbId: number;
  /** regions.code */
  regionCode: string;
  stage: ReleaseStage;
  /** 來源上市日狀態為 Cancelled（P22）。 */
  cancelled: boolean;
}

export interface TaxonomyRecord {
  igdbId: number;
  name: string;
  slug: string;
}

export interface GameCompanyRecord {
  company: TaxonomyRecord;
  /** 同公司兼多個角色就有多個值；可能為空（四個布林皆 false）。 */
  roles: GameCompanyRole[];
  /** 該公司在 IGDB involved_companies 陣列中第一次出現的位置（0 起算）；廠商分欄「取 IGDB 第一個」用（D88）。 */
  position: number;
}

export interface FranchiseRecord extends TaxonomyRecord {
  kind: FranchiseKind;
}

export interface GameLocalizationRecord {
  /** 我方語系碼（ja、ko…）。 */
  localeCode: string;
  name: string;
  coverUrl: string | null;
}

export interface LanguageRecord {
  igdbId: number;
  /** BCP-47（zh-TW → zh-Hant、zh-CN → zh-Hans）。 */
  code: string;
  name: string;
  nativeName: string | null;
}

export interface GameLanguageSupportRecord {
  language: LanguageRecord;
  supportType: LanguageSupportType;
}

export interface GameLinkRecord {
  linkType: GameLinkType;
  categoryLabel: string;
  url: string;
  /** websites.type 或 external_game_source 的 id，除錯用。 */
  igdbCategory: number;
  igdbOrigin: "website" | "external_game";
}

export interface FetchGamesQuery {
  /** 只取來源更新時間晚於此時刻的遊戲（增量同步）。 */
  updatedSince?: Date;
  /** id 游標：只取 id 大於此值者，依 id 升冪。 */
  afterId?: number;
  ids?: number[];
  /** 首發日（來源的 first_release_date）不早於此時刻。 */
  firstReleaseFrom?: Date;
  /** 沒有首發日、但至少有一筆上市日（04 §回填 Tier 1 (b)）。 */
  firstReleaseMissingWithDates?: boolean;
  /** 只取這些遊戲類型（白名單）。 */
  gameTypes?: readonly GameType[];
  /**
   * "detail"＝只取詳情補欄位（storyline、版本、人數、視角、引擎；backfill_detail_fields 用）；
   * "companies"＝只取 involved_companies（公司與角色、陣列順序；backfill_company_positions 用）；預設完整欄位。
   */
  fieldSet?: "full" | "detail" | "companies";
  limit: number;
}
