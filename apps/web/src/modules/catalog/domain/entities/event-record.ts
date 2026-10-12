/**
 * GameDataProvider.fetchEvents() 的回傳（04 §活動同步）：一場活動，來源格式已在 Provider 轉完。
 * kind／seriesId IGDB 沒有，由管理員標註，不在這裡。
 */
export interface EventRecord {
  igdbId: number;
  name: string;
  slug: string;
  description: string | null;
  /** NULL＝時間未定。 */
  startTime: Date | null;
  endTime: Date | null;
  /** 來源的時區縮寫（PST、JST…），有歧義，只供顯示，不可計算。 */
  timeZone: string | null;
  logoUrl: string | null;
  streamUrl: string | null;
  /** 參與遊戲的來源 id；由 resolve_relations 解析成 event_games。 */
  gameIgdbIds: number[];
  sourceUpdatedAt: Date | null;
}

/** 來源字典出現我方對照表沒見過的 id（04 §外部連結 漂移偵測）。 */
export interface DictionaryDrift {
  dictionary: string;
  newEntries: Array<{ id: number; name: string }>;
}

export interface FetchEventsQuery {
  /** 只取來源更新時間晚於此時刻的活動；省略＝全部。 */
  updatedSince?: Date;
}
