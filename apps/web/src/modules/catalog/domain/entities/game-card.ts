// 其他模組（accounts 的清單、遊玩紀錄、手動比對）顯示遊戲卡片所需的最少欄位（Phase 7 第 5 波）。零外部依賴。
import type { IsoDate } from "./enums";
import type { ImageRef } from "./image-ref";

/** 遊戲迷你卡片：slug、名稱、封面、首發日期。 */
export interface GameMiniCard {
  id: number;
  slug: string;
  /** 依 locale 的顯示名稱（games.displayNames），沒有則原名。 */
  name: string;
  /** games.name（原文）。 */
  originalName: string;
  cover: ImageRef | null;
  firstReleaseDate: IsoDate | null;
}

/** 某款遊戲可選的平台（遊玩紀錄的平台選項；不含 mobile）。 */
export interface GamePlatformOption {
  id: number;
  slug: string;
  name: string;
  abbreviation: string | null;
}

/** 平台簡述（遊玩紀錄列表顯示平台名稱用；D83）。 */
export interface PlatformBrief {
  id: number;
  name: string;
  abbreviation: string | null;
}

/** 遊戲搜尋（選擇器用）的筆數上限與預設。 */
export const GAME_SEARCH_LIMIT_MAX = 20;
export const GAME_SEARCH_LIMIT_DEFAULT = 10;
