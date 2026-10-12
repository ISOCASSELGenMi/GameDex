import type { PlatformRecord } from "../domain/entities";

/**
 * 主資料來源介面（04 §資料來源介面、D45）。同步、回填、校對只依賴這個介面；
 * 所有來源原始格式都在實作內轉成 Domain 型別。
 * fetchGames／fetchEvents 隨 Phase 2a 的 sync-games、sync-events 加入。
 */
export interface GameDataProvider {
  readonly sourceName: string;
  fetchPlatforms(): Promise<PlatformRecord[]>;
}
