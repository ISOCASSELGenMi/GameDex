// 瀏覽／搜尋讀取模型（Phase 3b，06 §瀏覽與搜尋）。Domain 型別，零外部依賴。
import type { DatePrecision, IsoDate } from "./enums";
import type { ImageRef } from "./image-ref";
import type { BrowseSort, IgnoredFilterValue, PlatformChip } from "./read-models";

export const BROWSE_PAGE_SIZE = 24;
export const BROWSE_PAGE_SIZE_MAX = 50;
/** offset 上限（深分頁成本高；超過回空頁）。 */
export const BROWSE_OFFSET_MAX = 5000;

export interface BrowseGameCard {
  gameId: number;
  slug: string;
  /** 依 locale 的顯示名稱（games.displayNames），沒有則原名。 */
  name: string;
  /** games.name（原文）；sort=name 依此排序，UI 標「依原文名稱排序」。 */
  originalName: string;
  cover: ImageRef | null;
  /** game_platforms（不含 mobile），依名稱排序。 */
  platforms: PlatformChip[];
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
  /** 0~5，0＝不顯示。 */
  heatLevel: number;
  popularityScore: number;
  gameType: string;
  /** rumored 等；NULL＝一般。 */
  gameStatus: string | null;
}

export interface BrowsePage {
  games: BrowseGameCard[];
  sort: BrowseSort;
  offset: number;
  limit: number;
  /** 還有下一頁。 */
  hasMore: boolean;
  /** 實際用來比對的搜尋字串（tokenizeForSearch 後）；沒有搜尋為 null。 */
  searchTokens: string | null;
  ignored: IgnoredFilterValue[];
}
