// 活動列表與詳情的讀取模型（06 §活動，Phase 3b）。Domain 型別，零外部依賴。
import type { EventKind } from "./enums";
import type { GameListItem } from "./entity-pages";
import type { CalendarEventItem } from "./read-models";

/**
 * 相對「現在」的時間狀態：
 * - upcoming：start_time > now
 * - ongoing：start_time ≤ now ≤ COALESCE(end_time, start_time)
 * - past：COALESCE(end_time, start_time) < now
 * - undated：start_time 為 NULL（「時間未定」，不進 iCal）
 */
export type EventTimeStatus = "upcoming" | "ongoing" | "past" | "undated";

/**
 * 列表範圍：
 * - upcoming：COALESCE(end_time, start_time) ≥ now（含進行中，06 §活動），開始時間舊到新
 * - past：COALESCE(end_time, start_time) < now，開始時間新到舊
 * - undated：start_time 為 NULL，依名稱
 */
export type EventListScope = "upcoming" | "past" | "undated";
export const EVENT_LIST_SCOPES: readonly EventListScope[] = ["upcoming", "past", "undated"];

export interface EventListItem extends CalendarEventItem {
  timeStatus: EventTimeStatus;
  streamUrl: string | null;
  /** 相關遊戲數（event_games，只算本站有的遊戲）。 */
  gameCount: number;
}

export interface EventList {
  scope: EventListScope;
  /** 套用的類型篩選；null＝全部（未知值視為未指定）。 */
  kind: EventKind | null;
  /** 1 起算。 */
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: EventListItem[];
}

export interface EventSeriesRef {
  slug: string;
  name: string;
  kind: EventKind;
}

export interface EventDetail extends EventListItem {
  description: string | null;
  /** 活動官網。 */
  url: string | null;
  organizer: string | null;
  series: EventSeriesRef | null;
  /** 同系列歷屆（不含本屆），開始時間新到舊（時間未定最後）。 */
  seriesEvents: EventListItem[];
  /** 相關遊戲，依 popularityScore 高到低、名稱；上限見 getEventDetail。總數見 gameCount。 */
  games: GameListItem[];
}
