import type { FetchGamesQuery, GameRecord, PlatformRecord } from "../domain/entities";

/**
 * 主資料來源介面（04 §資料來源介面、D45）。同步、回填、校對只依賴這個介面；
 * 所有來源原始格式都在實作內轉成 Domain 型別。
 * fetchEvents 隨 sync-events 加入。
 */
export interface GameDataProvider {
  readonly sourceName: string;
  fetchPlatforms(): Promise<PlatformRecord[]>;
  /** 一頁遊戲，依 igdbId 升冪；回傳筆數 < limit 表示沒有下一頁。 */
  fetchGames(q: FetchGamesQuery): Promise<GameRecord[]>;
}
