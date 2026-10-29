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
/**
 * 兩段式候選池（短字專用）：輸入 ≤ SUGGEST_HOT_MAX_CHARS 個字元時，先只在「熱度最高的 SUGGEST_HOT_WINDOW 筆」中找符合者，
 * 找滿 SUGGEST_CANDIDATE_POOL 筆就直接用（熱度排序下，前 120 筆符合者必在窗口內，結果與全表掃描相同）；不足才退回全表。
 * 窗口大小由開發 DB 量測決定（2026-10-29，約 31.7 萬款）：短字／高密度字的第 120 筆符合者落在熱度排名 134～1758（the 603、z 1307、の 1758），
 * 3000 涵蓋它們；窗口每多一筆，未命中時多花約 10 µs，所以不取更大（2 萬筆時稀有字會多花 130 ms）。
 */
export const SUGGEST_HOT_WINDOW = 3000;
/** 長度超過這個字元數（去空白）的查詢不走第一段：它們原本就 < 150 ms，多走一段只會讓稀有字變慢。 */
export const SUGGEST_HOT_MAX_CHARS = 3;
/** 名稱完全相同（lower(games.name) = 輸入）者另外用索引直接找，不論熱度高低都進候選（games_lower_name_prefix_idx）。 */
export const SUGGEST_EXACT_PROBE = 10;
