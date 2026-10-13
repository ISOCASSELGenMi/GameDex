// 平台／公司／系列頁的讀取模型（06 §路由，Phase 3b）。Domain 型別，零外部依賴。
// 時間點以 ISO 8601 字串（UTC）傳遞；純日期是 IsoDate。
import type {
  DatePrecision,
  FranchiseKind,
  GameCompanyRole,
  IsoDate,
  PlatformKind,
  PlatformStatus,
  ReleaseStage,
} from "./enums";
import type { GameSummary, PlatformChip, RegionCode } from "./read-models";

/** 分頁結果（limit／offset）。hasMore 以多查一筆判斷，不另算總數（大平台的總數很貴）。 */
export interface PagedList<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** 列表用的遊戲摘要（GameSummary＋遊戲層級狀態，rumored／cancelled 等由 UI 標示）。 */
export interface GameListItem extends GameSummary {
  /** games.gameStatus；NULL＝一般。 */
  gameStatus: string | null;
}

// ── 平台 ────────────────────────────────────────────────────────────────

export interface PlatformFamilyRef {
  slug: string;
  name: string;
}

export interface PlatformListItem extends PlatformChip {
  generation: number | null;
  family: PlatformFamilyRef | null;
  status: PlatformStatus;
  /** 平台 logo 的已存網址（原樣；與 CalendarEventItem.logoUrl 相同處理，見 3b H 報告）。 */
  logoUrl: string | null;
  /** 今天前後 365 天內的上市事件數。 */
  recentReleaseCount: number;
  /** 常用平台（與篩選面板同一規則 isCommonPlatform：近期事件 ≥ 200 且 kind 不是 other／mobile）。 */
  isCommon: boolean;
}

/** 平台總覽的一組（同 kind）。組內：常用在前（依近期事件數），其餘世代新到舊、名稱。 */
export interface PlatformKindGroup {
  kind: PlatformKind;
  platforms: PlatformListItem[];
}

export interface PlatformReleaseDateItem {
  regionCode: RegionCode;
  /** NULL＝日期未定。 */
  date: IsoDate | null;
  precision: DatePrecision;
}

export interface PlatformInfo extends PlatformListItem {
  alternativeName: string | null;
  summary: string | null;
  /** 只能人工填；NULL＝未知或仍在販售。 */
  discontinuedOn: IsoDate | null;
  /** platform_release_dates，依日期舊到新（未定最後）、地區代碼。 */
  releaseDates: PlatformReleaseDateItem[];
}

/**
 * 以「該平台」上市列的期間結束日判斷（day＝當日、month＝月底、quarter／year＝期間最後一天；tbd 不列）：
 * upcoming＝結束日 ≥ 今天；recent＝結束日在今天前 recentDays 天內（不含今天）。
 */
export type PlatformGamesSection = "upcoming" | "recent";
export const PLATFORM_GAMES_SECTIONS: readonly PlatformGamesSection[] = ["upcoming", "recent"];

/** date＝upcoming 舊到新／recent 新到舊（同日依熱度）；popularity＝popularityScore 高到低（同分依日期）。 */
export type PlatformGamesSort = "date" | "popularity";
export const PLATFORM_GAMES_SORTS: readonly PlatformGamesSort[] = ["date", "popularity"];

/** 平台頁的一款遊戲：日期是「該平台」的上市日（不是 games.firstReleaseDate）。 */
export interface PlatformGameItem extends GameListItem {
  /** 該平台在區段內最早（upcoming）／最晚（recent）的代表日期。 */
  date: IsoDate;
  precision: DatePrecision;
  stage: ReleaseStage;
}

export interface PlatformPage {
  platform: PlatformInfo;
  section: PlatformGamesSection;
  sort: PlatformGamesSort;
  games: PagedList<PlatformGameItem>;
}

// ── 公司 ────────────────────────────────────────────────────────────────

export interface CompanyInfo {
  slug: string;
  name: string;
  /** 已存網址（原樣）。 */
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface CompanyWork extends GameListItem {
  /** 此公司在這款遊戲的角色（developer、publisher、porting、supporting 順序）。 */
  roles: GameCompanyRole[];
}

export interface CompanyPage {
  company: CompanyInfo;
  /** 目前套用的角色篩選；null＝全部。 */
  role: GameCompanyRole | null;
  /** 各角色的作品數（套用遊戲類型篩選後；同款兼兩個角色兩邊都算）。 */
  roleCounts: Record<GameCompanyRole, number>;
  /** 全部角色合計的作品數（每款只算一次）。 */
  total: number;
  /** 依首發日期新到舊（未定最後）、名稱。 */
  works: PagedList<CompanyWork>;
}

// ── 系列 ────────────────────────────────────────────────────────────────

export interface FranchiseInfo {
  slug: string;
  name: string;
  kind: FranchiseKind;
  /** 同 slug 的其他 kind（IGDB 的 franchise 與 collection 可能同名同 slug），UI 可提供切換連結（?kind=）。 */
  otherKinds: FranchiseKind[];
}

export interface FranchisePage {
  franchise: FranchiseInfo;
  total: number;
  /** 依首發日期舊到新（未定最後）、名稱。 */
  games: PagedList<GameListItem>;
}

// ── 分頁參數 ────────────────────────────────────────────────────────────

export const ENTITY_PAGE_DEFAULT_LIMIT = 24;
export const ENTITY_PAGE_MAX_LIMIT = 100;
/** 過深的 offset 很貴且沒有使用情境；超過即夾到此值。 */
export const ENTITY_PAGE_MAX_OFFSET = 10_000;

/** limit／offset 正規化：非數字或越界時夾到合法範圍（不 throw）。 */
export function normalizePaging(
  limit: number | null | undefined,
  offset: number | null | undefined,
  defaultLimit: number = ENTITY_PAGE_DEFAULT_LIMIT,
): { limit: number; offset: number } {
  const l = Number.isFinite(limit) ? Math.floor(limit as number) : defaultLimit;
  const o = Number.isFinite(offset) ? Math.floor(offset as number) : 0;
  return {
    limit: Math.min(ENTITY_PAGE_MAX_LIMIT, Math.max(1, l)),
    offset: Math.min(ENTITY_PAGE_MAX_OFFSET, Math.max(0, o)),
  };
}
