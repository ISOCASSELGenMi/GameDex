import type { DatePrecision, IsoDate, ReleaseStage, ReleaseStatus, SourceStatus } from "./enums";

/** 一列 = 一款遊戲 × 一個平台 × 一個地區 × 一個上市階段（D5、D49）。 */
export interface ReleaseEvent {
  id: number;
  gameId: number;
  platformId: number;
  regionId: number;
  /** 代表日期（P24）：day＝當日；month＝當月第一天；quarter/year＝期間最後一天；tbd＝NULL。 */
  releaseDate: IsoDate | null;
  /** 期間第一天；day/month 同 releaseDate；tbd＝NULL。 */
  periodStart: IsoDate | null;
  precision: DatePrecision;
  status: ReleaseStatus;
  releaseStage: ReleaseStage;
  sourceStatus: SourceStatus;
  /** iCal SEQUENCE：日期或 status 變動時 +1（08）。 */
  sequence: number;
  source: string | null;
  sourceUpdatedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** diff 比對鍵（03 §索引總表）。 */
export interface ReleaseEventKey {
  gameId: number;
  platformId: number;
  regionId: number;
  releaseStage: ReleaseStage;
}

export type ReleaseEventInput = ReleaseEventKey &
  Pick<ReleaseEvent, "releaseDate" | "periodStart" | "precision" | "status"> &
  Partial<Pick<ReleaseEvent, "sourceStatus" | "source" | "sourceUpdatedAt">>;

/** upsert 的結果，供 Use Case 判斷（例如統計、log）。 */
export type ReleaseEventUpsertResult =
  | { kind: "created"; event: ReleaseEvent }
  | { kind: "updated"; event: ReleaseEvent; dateChanged: boolean; statusChanged: boolean }
  | { kind: "unchanged"; event: ReleaseEvent };
