// 讀取模型（Phase 3a：月曆、遊戲詳情、篩選）。Domain 型別，零外部依賴。
// 時間點一律以 ISO 8601 字串（UTC，`...Z`）傳遞，方便 Server Component 序列化；純日期是 IsoDate。
import type {
  DatePrecision,
  EventKind,
  FranchiseKind,
  GameCompanyRole,
  GameLinkType,
  IsoDate,
  PlatformKind,
  ReleaseStage,
  ReleaseStatus,
  SourceStatus,
} from "./enums";

/** regions.code（WW、US、EU、JP…）。地區偏好＝使用者設定 > 瀏覽器語系推導 > DEFAULT_REGION_PREF（06 §聚合規則 3）。 */
export type RegionCode = string;

/** 篩選維度名稱（回報被忽略的值用）。 */
export type ReleaseFilterDimension = "platform" | "platformKind" | "genre" | "stage" | "type" | "status";

/**
 * 月曆／時間軸的篩選條件（UI 由 FilterSpec 轉來；值一律 slug／enum 值）。
 * 同維度 OR、跨維度 AND（06 §篩選）。未給的維度＝不限制；`stages`、`gameTypes`、`statuses` 未給時套用預設。
 */
export interface ReleaseFilter {
  platformSlugs?: readonly string[];
  platformKinds?: readonly string[];
  genreSlugs?: readonly string[];
  /** 預設 CALENDAR_VISIBLE_RELEASE_STAGES（unspecified,full,early_access）。 */
  stages?: readonly string[];
  /** 預設 CALENDAR_VISIBLE_GAME_TYPES（main_game,standalone_expansion,remake,remaster,port）。 */
  gameTypes?: readonly string[];
  /** 上市列的 status；預設 scheduled、delayed、released（cancelled 預設不顯示，見報告待決）。 */
  statuses?: readonly string[];
  /** `rumored=1`：顯示 gameStatus='rumored' 的遊戲（預設隱藏，04 §遊戲層級狀態）。 */
  includeRumored?: boolean;
}

export interface IgnoredFilterValue {
  dimension: ReleaseFilterDimension;
  /** 被忽略的原始值（未知 slug、未知 enum 值、或超過上限的值）。 */
  slug: string;
}

/** resolveFilterSlugs 的結果：slug 已換成 id、預設值已套用。由 Repository 使用。 */
export interface ResolvedReleaseFilter {
  /** undefined＝不限制。若使用者給的值全部未知，該維度視為未指定（並在 ignored 回報）。 */
  platformIds?: readonly number[];
  platformKinds?: readonly PlatformKind[];
  genreIds?: readonly number[];
  stages: readonly ReleaseStage[];
  gameTypes: readonly string[];
  statuses: readonly ReleaseStatus[];
  includeRumored: boolean;
  /** source_status='removed' 的列是否納入；預設 true（D7：removed 不等於取消，網站照常顯示並加註）。 */
  includeRemoved: boolean;
}

export interface PlatformChip {
  slug: string;
  name: string;
  abbreviation: string | null;
  kind: PlatformKind;
}

/**
 * 一張卡＝同一款遊戲、同一個代表日期＋精度＋階段的合併結果（06 §聚合規則 2），平台以 chip 呈現。
 * `date` 是代表日期（P24）：day＝當日；month＝當月第一天；quarter/year＝期間最後一天。
 */
export interface ReleaseCard {
  gameId: number;
  slug: string;
  /** 依 locale 從 games.displayNames 取，沒有則為原名。 */
  name: string;
  /** games.name（原文）。 */
  originalName: string;
  /** IGDB 圖片 id（例 `co6fyp`），UI 以 igdbImageUrl(id, size) 換尺寸；沒有封面為 null。 */
  coverImageId: string | null;
  /** tbd 精度為 null（只有呼叫端明確要求 tbd 時才會出現；月曆不會）。 */
  date: IsoDate | null;
  periodStart: IsoDate | null;
  precision: DatePrecision;
  stage: ReleaseStage;
  /** 合併後的狀態：任一平台 delayed → delayed；否則 scheduled → released → cancelled。 */
  status: ReleaseStatus;
  /** 合併進卡片的列全部是 removed 才是 removed；UI 加註「資料來源待確認」（D7）。 */
  sourceStatus: SourceStatus;
  platforms: PlatformChip[];
  /** 0~1000。 */
  popularityScore: number;
  /** 0~5，0＝不顯示。 */
  heatLevel: number;
  gameType: string;
  /** games.gameStatus（rumored、cancelled…）；NULL＝一般。 */
  gameStatus: string | null;
  /** 合併進這張卡的 release_events.id（每個平台一筆，依平台名稱排序）。 */
  releaseEventIds: number[];
}

export interface CalendarEventItem {
  id: number;
  slug: string;
  name: string;
  kind: EventKind;
  /** ISO 8601（UTC）；NULL＝時間未定。 */
  startTime: string | null;
  endTime: string | null;
  /** IGDB 時區縮寫，只供附註，不可計算。 */
  timezone: string | null;
  logoUrl: string | null;
}

export interface CalendarMonth {
  year: number;
  month: number;
  /** 鍵為 `YYYY-MM-DD`（只含有卡片的日子）；每天依 popularityScore 由高到低，同分依名稱。 */
  days: Record<IsoDate, ReleaseCard[]>;
  /** 本月未定日：月精度（代表日＝本月 1 日）＋季／年精度（期間最後一個月＝本月）。依精度（月→季→年）、熱度、名稱排序。 */
  undated: ReleaseCard[];
  /** 與本月有交集的活動（start_time ≤ 月底 且 COALESCE(end_time, start_time) ≥ 月初），依開始時間排序。 */
  events: CalendarEventItem[];
  /** 被忽略的篩選值（未知 slug 等），UI 顯示提示。 */
  ignored: IgnoredFilterValue[];
}

// ── 遊戲詳情 ────────────────────────────────────────────────────────────

export interface GameSummary {
  gameId: number;
  slug: string;
  name: string;
  originalName: string;
  coverImageId: string | null;
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
  gameType: string;
  popularityScore: number;
}

export interface ReleaseDateChange {
  oldDate: IsoDate | null;
  oldPrecision: DatePrecision | null;
  newDate: IsoDate | null;
  newPrecision: DatePrecision | null;
  /** ISO 8601（UTC）。 */
  changedAt: string | null;
}

export interface GameReleaseRow {
  releaseEventId: number;
  regionCode: RegionCode;
  stage: ReleaseStage;
  date: IsoDate | null;
  periodStart: IsoDate | null;
  precision: DatePrecision;
  status: ReleaseStatus;
  /** removed＝來源已沒有這筆（D7：不等於取消，顯示「資料來源待確認」）。 */
  sourceStatus: SourceStatus;
  source: string;
  /** 改期紀錄（release_date_history），舊到新。 */
  history: ReleaseDateChange[];
}

export interface GameReleaseGroup {
  platform: PlatformChip;
  /** 依偏好地區 → WW → 其他地區（依代表日期）排序；同地區依階段。 */
  releases: GameReleaseRow[];
}

export interface GameCompanyCredit {
  slug: string;
  name: string;
  /** 同公司兼多個角色時合併（developer、publisher、porting、supporting 順序）。 */
  roles: GameCompanyRole[];
}

export interface GameLink {
  linkType: GameLinkType;
  /** 'steam'、'playstation_store'、'official_website'…（UI 以字典顯示）。 */
  categoryLabel: string;
  url: string;
  isBroken: boolean;
}

export interface GameFranchiseGroup {
  slug: string;
  name: string;
  kind: FranchiseKind;
  /** 同系列其他作品（不含本作），依首發日期舊到新，上限見 getGameDetail。 */
  games: GameSummary[];
}

export interface TaxonomyItem {
  slug: string;
  /** 原文名稱（UI 以字典翻譯，缺翻譯 fallback 此值）。 */
  name: string;
}

export interface GameDetail {
  gameId: number;
  igdbId: number;
  slug: string;
  /** 依 locale 的顯示名稱。 */
  name: string;
  /** 原名（games.name）。 */
  originalName: string;
  /** 簡介原文（IGDB 只有英文，UI 標「原文（English）」）。 */
  summary: string | null;
  coverImageId: string | null;
  screenshotImageIds: string[];
  trailerUrl: string | null;
  ageRatingLabel: string | null;
  gameType: string;
  /** rumored → UI 標「傳聞」；cancelled 等也在此。 */
  gameStatus: string | null;
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
  popularityScore: number;
  heatLevel: number;
  /** game_platforms（不含 mobile），依名稱排序。 */
  platforms: PlatformChip[];
  genres: TaxonomyItem[];
  themes: TaxonomyItem[];
  /** 依平台分行；平台依名稱排序。含 removed 列（標 sourceStatus）。 */
  releaseGroups: GameReleaseGroup[];
  developers: GameCompanyCredit[];
  publishers: GameCompanyCredit[];
  /** 依角色分好的全部公司（含 porting、supporting）。 */
  companies: GameCompanyCredit[];
  /** 商店先、官網次、社群、媒體；同類型依固定分類順序。 */
  links: GameLink[];
  /** 本體遊戲（parentGameId 反查）；本體尚未同步時為 null（不是錯誤）。 */
  parent: GameSummary | null;
  franchises: GameFranchiseGroup[];
  /** 依 popularityScore 由高到低，上限 12。 */
  similarGames: GameSummary[];
  /** DLC／額外內容（其他遊戲的 parentGameId＝本作 igdbId），依首發日期。 */
  dlcs: GameSummary[];
  /** 即將亮相的活動（COALESCE(end_time, start_time) ≥ now()），依開始時間。 */
  upcomingEvents: CalendarEventItem[];
}

// ── 篩選選項 ────────────────────────────────────────────────────────────

export interface PlatformOption extends PlatformChip {
  generation: number | null;
  /** 常用平台（今天前後 365 天上市事件 ≥ 200，且 kind 不是 other），UI 置頂或預設展開。 */
  isCommon: boolean;
  /** 今天前後 365 天內的上市事件數（排序依據，僅供參考）。 */
  recentReleaseCount: number;
}

export interface FilterOptions {
  /** 不含 mobile。常用平台在前（依近期事件數），其餘依種類、世代新到舊、名稱。 */
  platforms: PlatformOption[];
  /** 不含 mobile。 */
  platformKinds: PlatformKind[];
  /** 依原文名稱排序。 */
  genres: TaxonomyItem[];
  stages: ReleaseStage[];
  /** 預設可見的階段（CALENDAR_VISIBLE_RELEASE_STAGES）。 */
  defaultStages: ReleaseStage[];
  /** 預設可見的遊戲類型（CALENDAR_VISIBLE_GAME_TYPES）。 */
  defaultGameTypes: string[];
}
