// 「我的遊戲」讀取模型（Phase 7 第 6 波）：給定一組遊戲 id，回遊戲卡片＋最近的上市日（聚合規則同月曆）。零外部依賴。
import type { DatePrecision, IsoDate, ReleaseStage, ReleaseStatus } from "./enums";
import type { GameMiniCard } from "./game-card";
import type { PlatformChip } from "./read-models";

/** 這款遊戲「最近的上市日」（聚合規則挑出的卡片；同一天的多個平台合併成 chip）。 */
export interface MyGameRelease {
  /** 代表日期（day＝當日；month＝當月 1 日；quarter／year＝期間最後一天）；tbd 為 null。 */
  date: IsoDate | null;
  precision: DatePrecision;
  stage: ReleaseStage;
  status: ReleaseStatus;
  platforms: PlatformChip[];
  /** upcoming＝尚未開始或進行中的期間；tbd＝日期未定；past＝已過（沒有未來的上市時才取最近一筆過去的）。 */
  relation: "upcoming" | "tbd" | "past";
}

export interface MyGameItem {
  game: GameMiniCard;
  /** 沒有任何符合條件的上市資料時為 null。 */
  nextRelease: MyGameRelease | null;
}

export interface MyGamesPage {
  items: MyGameItem[];
  /** 符合條件的遊戲總數（分頁前）。 */
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export const MY_GAMES_LIMIT_DEFAULT = 24;
export const MY_GAMES_LIMIT_MAX = 100;
/** 一次最多處理的遊戲 id 數（超過的截斷，由呼叫端決定順序）。 */
export const MY_GAMES_IDS_MAX = 20000;
