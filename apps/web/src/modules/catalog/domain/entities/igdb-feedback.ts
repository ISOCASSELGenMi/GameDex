// 待回饋 IGDB 清單（12 §待回饋 IGDB 清單，D91）。Domain 型別與 enum 值；零外部依賴。
import type { DatePrecision, IsoDate, LanguageSupportType, ReleaseStage } from "./enums";

/** 可回饋的欄位鍵。新增欄位＝在 domain/igdb-feedback-fields.ts 加一筆登錄（值的形狀、建立、採納偵測）。 */
export const IGDB_FEEDBACK_FIELDS = [
  "release_date",
  "region_date",
  "stage",
  "language_support",
  "cancelled",
  "localized_title",
] as const;
export type IgdbFeedbackField = (typeof IGDB_FEEDBACK_FIELDS)[number];

export const IGDB_FEEDBACK_STATUSES = ["pending", "submitted", "adopted", "skipped"] as const;
export type IgdbFeedbackStatus = (typeof IGDB_FEEDBACK_STATUSES)[number];

/** 管理者可手動做的動作（adopted 只由同步偵測設定）。 */
export const IGDB_FEEDBACK_ACTIONS = ["submit", "skip", "reopen"] as const;
export type IgdbFeedbackAction = (typeof IGDB_FEEDBACK_ACTIONS)[number];

/** 舊值／新值（jsonb）。各欄位只用其中幾個鍵，由登錄表決定。 */
export interface IgdbFeedbackValue {
  date?: IsoDate | null;
  precision?: DatePrecision;
  stage?: ReleaseStage;
  language?: string;
  supportType?: LanguageSupportType;
  /** release_events.status 或 games.gameStatus 的值。 */
  status?: string | null;
  title?: string | null;
}

/** 由回報算出的項目內容（尚未寫入）。 */
export interface IgdbFeedbackDraft {
  field: IgdbFeedbackField;
  platformId: number | null;
  regionCode: string | null;
  stage: ReleaseStage | null;
  oldValue: IgdbFeedbackValue | null;
  newValue: IgdbFeedbackValue;
}

export interface IgdbFeedbackItem extends IgdbFeedbackDraft {
  id: number;
  reportId: number;
  gameId: number;
  igdbGameId: number;
  /** 即 IGDB 的遊戲 slug（games.slug）。 */
  gameSlug: string;
  sourceUrl: string | null;
  reporterNote: string | null;
  status: IgdbFeedbackStatus;
  handlerNote: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  statusChangedAt: Date | null;
  adoptedAt: Date | null;
}

/** 後台清單一筆：項目＋遊戲名稱、平台名稱、欄位說明與可貼到 IGDB 的整理文字。 */
export interface IgdbFeedbackListItem extends IgdbFeedbackItem {
  gameName: string;
  platformName: string | null;
  /** 「平台／地區／階段」，沒有定位資料為空字串。 */
  locationText: string;
  fieldLabel: string;
  igdbLocation: string;
  igdbUrl: string;
  oldText: string;
  newText: string;
  pasteText: string;
}
