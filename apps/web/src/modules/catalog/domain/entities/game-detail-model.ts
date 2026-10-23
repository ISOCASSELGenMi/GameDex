import type { GameDetailExtra } from "./game-detail-extra";
import type { GameDetailBase } from "./read-models";

/** 遊戲詳情讀取模型：既有欄位＋詳情補資訊 `extra`（GameDex 第二輪 Z4；合約型別見 game-detail-extra.ts）。 */
export interface GameDetail extends GameDetailBase {
  extra: GameDetailExtra;
}
