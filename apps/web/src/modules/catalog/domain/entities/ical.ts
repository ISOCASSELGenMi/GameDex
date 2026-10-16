// iCal 輸出用的資料形狀（08）。Domain 型別，零外部依賴。
import type { DatePrecision, EventKind, IsoDate, ReleaseStage, ReleaseStatus } from "./enums";

/** feed 種類：公開三種＋單一遊戲下載＋私人追蹤 feed（Phase 7 第 6 波；日曆名稱由使用者設定）。 */
export type IcalFeedKind = "releases" | "events" | "platform" | "game" | "following";

/**
 * 一個 iCal 上市項目＝聚合規則在 (遊戲, 平台, 階段) 挑出的那一列（UID 粒度，D26）。
 * 地區只是屬性（`regionCode`）；`sequence`、`updatedAt` 是整組（含其他地區、removed）的總和／最大值。
 */
export interface IcalReleaseItem {
  gameId: number;
  gameSlug: string;
  /** 依 feed 語系（games.displayNames），沒有則原名。 */
  gameName: string;
  platformId: number;
  platformName: string;
  platformAbbreviation: string | null;
  stage: ReleaseStage;
  /** 聚合挑中那一列的地區代碼（regions.code）。 */
  regionCode: string;
  /** 代表日期（day＝當日；month＝當月 1 日；quarter／year＝期間最後一天）；tbd 為 null。 */
  date: IsoDate | null;
  precision: DatePrecision;
  status: ReleaseStatus;
  /** 該組所有上市事件 sequence 的總和（單調不減，08 §RFC 5545 規則 1）。 */
  sequence: number;
  /** 該組所有上市事件 updatedAt 的最大值（DTSTAMP／LAST-MODIFIED，不用產生當下的時間）。 */
  updatedAt: Date;
  /**
   * 只在 `precision = tbd` 時有值：改成 tbd 之前最後一個已知日期與精度（release_date_history.old_*）。
   * 沒有（從未有過日期）→ 不輸出這個項目。
   */
  lastKnownDate: IsoDate | null;
  lastKnownPrecision: DatePrecision | null;
}

/** 一個 iCal 活動項目（events）。`sequence`＝start_time 改期的次數（change_feed `date_changed`）。 */
export interface IcalEventItem {
  id: number;
  slug: string;
  name: string;
  kind: EventKind;
  description: string | null;
  /** 一定有值（start_time 為 NULL 的活動不進 iCal）。 */
  startTime: Date;
  endTime: Date | null;
  url: string | null;
  streamUrl: string | null;
  organizer: string | null;
  sequence: number;
  updatedAt: Date;
}

/** ETag 用的 feed 摘要：一個聚合查詢算出（不先產生整份）。 */
export interface IcalFeedMeta {
  count: number;
  /** 沒有項目時為 null。 */
  maxUpdatedAt: Date | null;
}

/** 公開 feed 視窗常數（08 §公開 feed、§RFC 5545 規則 3）。 */
export const ICAL_WINDOW_DAYS = 90;
/** 近 N 天內有改期紀錄的項目，離開視窗後仍輸出。 */
export const ICAL_RECENT_CHANGE_DAYS = 60;
/** 取消、延期成 tbd 後保留的天數。 */
export const ICAL_RETAIN_DAYS = 30;
