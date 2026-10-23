/**
 * 遊戲瀏覽頁 `/games` 的分組檢視（`?by=none|date|platform|publisher`）的讀取模型。零外部依賴。
 * 分組只在 repository 的 SQL 做（篩選條件與瀏覽共用 buildBrowseConditions），這裡只有型別與常數。
 */
import type { PlatformKind } from "./enums";
import type { BrowseGameCard } from "./browse";

export const GAME_GROUP_BYS = ["none", "date", "platform", "publisher"] as const;
export type GameGroupBy = (typeof GAME_GROUP_BYS)[number];
export const DEFAULT_GAME_GROUP_BY: GameGroupBy = "none";
/** 真正分組的方式（不含 none）。 */
export type GroupedBy = Exclude<GameGroupBy, "none">;

/** 一頁幾組（以 `page` 翻組；不是翻遊戲）。 */
export const GAME_GROUPS_PER_PAGE = 6;
/** 每組首屏先送幾張卡（其餘「顯示更多」按需載入）。頁面 HTML 預算 200 KB（含 RSC payload）。 */
export const GAME_GROUP_INITIAL = 6;
/** 「顯示更多」一次載入幾張。 */
export const GAME_GROUP_MORE = 24;
/** API 單次上限。 */
export const GAME_GROUP_MAX_LIMIT = 60;
/** 組頁碼上限（日期分組最多約幾百個月）。 */
export const GAME_GROUP_MAX_PAGE = 200;

/**
 * 一組。key：
 * - date：`YYYY-MM`（日／月精度）、`YYYY-Qn`（季精度）、`YYYY`（年精度）、`tbd`（日期未定，永遠最後）；
 * - platform：平台 slug；publisher：廠商欄 key（含 other）。
 */
export interface GameGroup {
  key: string;
  /** 這一組符合條件的總張數（平台分組：同一款遊戲在它每個平台組各算一次）。 */
  total: number;
  /** 前 limit 張（組內排序）。 */
  cards: BrowseGameCard[];
  /** 只有 by=platform：組頭用的平台資料。 */
  platform?: { slug: string; name: string; kind: PlatformKind };
}
