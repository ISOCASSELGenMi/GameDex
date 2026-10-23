// 搜尋候選（header／首頁／遊戲列表頁的搜尋框打字時列出的候選）。零外部依賴。
import type { ImageRef } from "./image-ref";

/** 一筆搜尋候選：封面、依介面語言的標題、上市年份、主要平台（最多 SUGGEST_PLATFORM_MAX 個）。 */
export interface GameSuggestion {
  id: number;
  slug: string;
  /** 依 locale 的顯示名稱（games.displayNames），沒有則原名。 */
  name: string;
  /** games.name（原文）。 */
  originalName: string;
  cover: ImageRef | null;
  /** 首發日期的年份；日期未定為 null。 */
  year: number | null;
  /** 平台縮寫（沒有縮寫用名稱），依名稱排序。 */
  platforms: string[];
}

export const SUGGEST_LIMIT_DEFAULT = 8;
export const SUGGEST_LIMIT_MAX = 10;
export const SUGGEST_PLATFORM_MAX = 3;
/** 排序前的候選池：符合者中熱度最高的前 N 筆（見 repository/game-suggest.ts）。 */
export const SUGGEST_CANDIDATE_POOL = 120;
/** 名稱完全相同（lower(games.name) = 輸入）者另外用索引直接找，不論熱度高低都進候選（games_lower_name_prefix_idx）。 */
export const SUGGEST_EXACT_PROBE = 10;
