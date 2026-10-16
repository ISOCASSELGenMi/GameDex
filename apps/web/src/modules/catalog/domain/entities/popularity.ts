// 熱度（03 §熱度、06 §熱度顯示）。Domain 型別，零外部依賴；IGDB 的 popularity_type 數字只在 Provider 層。
import type { DatePrecision, IsoDate, PlatformKind } from "./enums";
import type { ImageRef } from "./image-ref";

/**
 * 外部熱度訊號擴充點（03 §熱度、02 §擴充點）：可選模組（`accounts` 的 site_follows 等）實作後經 manifest
 * 的 `popularitySignals` 提供給 catalog；catalog 不 import 提供者。
 * `fetch` 回傳我方 `games.id` 與整數值；`gameIds` 省略＝全部遊戲。
 */
export interface PopularitySignal {
  /** 'site_follows' | 'site_follows_7d' | …；寫入 game_popularity_signals.signal_name（≤ 32 字元）。 */
  readonly name: string;
  fetch(q: { gameIds?: number[] }): Promise<Array<{ gameId: number; value: number }>>;
}

/** catalog 自己算的訊號名稱（外部訊號不可使用）。 */
export const CATALOG_SIGNAL_NAMES = ["igdb_hype", "structural"] as const;
export type CatalogSignalName = (typeof CATALOG_SIGNAL_NAMES)[number];

/** 站內追蹤人數訊號名稱（accounts 提供）；有這個訊號時才有 wSite（03 §熱度 步驟 3）。 */
export const SITE_FOLLOWS_SIGNAL = "site_follows";
/** 站內近 7 天新增追蹤數（accounts 提供）；`/trending` 排序與「上升中」用（06 §熱度顯示）。 */
export const SITE_FOLLOWS_7D_SIGNAL = "site_follows_7d";
/** catalog 認得、由可選模組提供的外部訊號名稱；提供者沒註冊（模組停用）時，refresh_popularity 會清掉這些訊號的舊列。 */
export const KNOWN_EXTERNAL_SIGNAL_NAMES = [SITE_FOLLOWS_SIGNAL, SITE_FOLLOWS_7D_SIGNAL] as const;

/** 外部來源的人氣原始訊號種類（我方名稱）。IGDB：2＝Want to Play、10＝Most Wishlisted Upcoming。 */
export const EXTERNAL_HYPE_KINDS = ["want_to_play", "most_wishlisted_upcoming"] as const;
export type ExternalHypeKind = (typeof EXTERNAL_HYPE_KINDS)[number];

/** Provider 轉好的一筆人氣原始值；`value` 只用來在同種類內排序（03 §熱度）。 */
export interface ExternalHypeRecord {
  igdbGameId: number;
  signal: ExternalHypeKind;
  value: number;
}

/** 每個種類的最近計算時間（來源整批重算的版本）；沒有資料為 null。 */
export type ExternalHypeVersion = Partial<Record<ExternalHypeKind, string | null>>;

/** 熱度原始訊號來源（目前只有 IGDB Provider 實作）。 */
export interface ExternalHypeSource {
  /** 便宜的版本檢查（每種類 1 個請求）：ISO 8601 時間字串；用來判斷要不要重抓全量。 */
  fetchHypeVersion(): Promise<ExternalHypeVersion>;
  /** 全部種類的全部原始值（分頁抓完）。 */
  fetchHypeRecords(): Promise<ExternalHypeRecord[]>;
}

/** 熱度分群（03 §熱度 步驟 2）：upcoming＝未上市或上市 ≤ 30 天（含無日期）；released＝其餘。 */
export const POPULARITY_GROUPS = ["upcoming", "released"] as const;
export type PopularityGroup = (typeof POPULARITY_GROUPS)[number];

// ── 熱門榜（06 §熱度顯示：/trending）────────────────────────────────────

export interface TrendingCard {
  gameId: number;
  slug: string;
  /** 依 locale 從 games.displayNames 取，沒有則為原名。 */
  name: string;
  /** games.name（原文）。 */
  originalName: string;
  cover: ImageRef | null;
  /** 0~5；榜上一律 ≥ 1（heatLevel 0＝完全無訊號，不上榜）。 */
  heatLevel: number;
  /** 0~1000。 */
  popularityScore: number;
  /** 代表上市日（games.firstReleaseDate）與精度；未定為 null。 */
  releaseDate: IsoDate | null;
  releasePrecision: DatePrecision | null;
  gameType: string;
  gameStatus: string | null;
}

export interface TrendingPage {
  group: PopularityGroup;
  items: TrendingCard[];
  limit: number;
  offset: number;
  /** 還有下一頁（多抓一筆判斷）。 */
  hasMore: boolean;
  /** 這一頁實際使用的排序依據（accounts 啟用時 site_follows_7d）。 */
  rankedBy?: "popularity" | "site_follows_7d";
}

/** 熱門榜篩選（已解析成 id）；與月曆共用 ResolvedReleaseFilter 的維度子集。 */
export interface TrendingFilter {
  platformIds?: readonly number[];
  platformKinds?: readonly PlatformKind[];
  genreIds?: readonly number[];
  gameTypes: readonly string[];
  includeRumored: boolean;
}
