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
import type { ImageRef } from "./image-ref";
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
  /** platforms.id（追蹤、私人 iCal 篩選用）。 */
  id: number;
  generation: number | null;
  family: PlatformFamilyRef | null;
  status: PlatformStatus;
  /** 平台 logo（已解析各尺寸，與封面相同經 ImageResolver；kind＝logo）。UI 用這個。 */
  logo: ImageRef | null;
  /** @deprecated 已存的原始網址（＝logo?.original），只為相容保留；UI 請用 `logo`。 */
  logoUrl: string | null;
  /** 今天前後 365 天內的上市事件數。 */
  recentReleaseCount: number;
  /** 常用平台（與篩選面板同一規則 isCommonPlatform：近期事件 ≥ 200 且 kind 不是 other／mobile）。 */
  isCommon: boolean;
  /** 平台發售日：platform_release_dates 裡最早一筆有日期的（各地區取最早）；全部沒有日期為 null。 */
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
}

/**
 * 平台總覽的排序（`/platforms?sort=release&dir=asc|desc`）：release＝依平台發售日，沒有日期的平台永遠排最後；
 * 預設 release／desc（新到舊）。組內平手依常用度（原本的組內順序）。
 */
export const PLATFORM_OVERVIEW_SORTS = ["release"] as const;
export type PlatformOverviewSort = (typeof PLATFORM_OVERVIEW_SORTS)[number];
export const PLATFORM_OVERVIEW_DIRS = ["asc", "desc"] as const;
export type PlatformOverviewDir = (typeof PLATFORM_OVERVIEW_DIRS)[number];
export const DEFAULT_PLATFORM_OVERVIEW_DIR: PlatformOverviewDir = "desc";
export interface PlatformOverviewOrder {
  sort: PlatformOverviewSort;
  dir: PlatformOverviewDir;
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
 * 以聚合規則挑出的「該平台」代表上市列判斷（與月曆的上市狀態篩選同一份規則，期間結束日：day＝當日、month＝月底、
 * quarter／year＝期間最後一天；tbd 不列）：
 * upcoming＝未標為已上市且結束日 ≥ 今天；recent＝已上市（status released 或結束日 < 今天）、代表日期 ≤ 今天，
 * 且結束日在今天前 recentDays 天內。
 */
export type PlatformGamesSection = "upcoming" | "recent" | "all";
export const PLATFORM_GAMES_SECTIONS: readonly PlatformGamesSection[] = ["upcoming", "recent", "all"];

/**
 * date＝upcoming 舊到新／recent、all 新到舊（同日依熱度；all 的日期未定者排最後）；
 * popularity＝popularityScore 高到低（同分依日期）；name＝顯示名稱 A→Z。
 * all 區段（該平台過往與未來所有上市列，不限天數與上市狀態）預設用 date（新到舊）。
 */
export type PlatformGamesSort = "date" | "popularity" | "name";
export const PLATFORM_GAMES_SORTS: readonly PlatformGamesSort[] = ["date", "popularity", "name"];

/**
 * 平台頁的一筆：聚合規則（地區偏好、manual 優先…，與月曆相同）挑出的「該平台」代表上市列，一筆＝(遊戲, 階段)；
 * 同一款遊戲在此平台有多個可見階段（例如搶先體驗＋正式版）時會有多筆。日期不是 games.firstReleaseDate。
 */
export interface PlatformGameItem extends GameListItem {
  /** 該平台、該階段的代表日期（month 精度＝當月 1 日；quarter／year＝期間最後一天）；all 區段日期未定者為 null。 */
  date: IsoDate | null;
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
  /** companies.id（追蹤用）。 */
  id: number;
  slug: string;
  name: string;
  /** 公司 logo（已解析各尺寸，經 ImageResolver；kind＝logo）。UI 用這個。 */
  logo: ImageRef | null;
  /** @deprecated 已存的原始網址（＝logo?.original），只為相容保留；UI 請用 `logo`。 */
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
  /** franchises.id（追蹤用；franchise 與 collection 同 slug 時各有自己的 id）。 */
  id: number;
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
