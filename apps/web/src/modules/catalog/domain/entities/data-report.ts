// 資料更正回報（12 §資料更正回報）。Domain 型別與 enum 值；零外部依賴。
import type { DatePrecision, IsoDate, LanguageSupportType, ReleaseStage } from "./enums";

export const REPORT_TARGET_TYPES = ["release_event", "game", "platform", "event"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_TYPES = [
  "wrong_date",
  "missing_region_date",
  "wrong_stage",
  "language_support",
  "cancelled",
  "localized_title",
  "field_correction",
  "duplicate",
  "takedown",
  "other",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = ["open", "accepted", "rejected", "duplicate"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** 審核動作；accept→accepted、reject→rejected、duplicate→duplicate。 */
export const REPORT_ACTIONS = ["accept", "reject", "duplicate"] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/**
 * field_correction 的欄位鍵（D92）：IGDB 允許貢獻的欄位都能回報。每個鍵的值形狀與允許動作見 domain/field-corrections.ts，
 * 登錄表（domain/igdb-feedback-fields.ts）以同一組鍵建立待回饋 IGDB 項目。
 */
export const FIELD_CORRECTION_KEYS = [
  "name", "summary", "storyline", "game_type", "game_status", "alternative_name", "localized_title_other",
  "cover", "screenshot", "video",
  "genre", "theme", "game_mode", "player_perspective", "engine", "platform",
  "company_developer", "company_publisher", "company_supporting",
  "franchise", "collection", "external_link", "age_rating", "relation_parent",
] as const;
export type FieldCorrectionKey = (typeof FIELD_CORRECTION_KEYS)[number];

export const FIELD_OPS = ["add", "change", "remove"] as const;
export type FieldOp = (typeof FIELD_OPS)[number];

/** 關聯類型（relation_parent）：本傳、版本本體，或以本作為本傳的 DLC／擴充。 */
export const FIELD_RELATIONS = ["parent", "version_parent", "dlc", "expansion"] as const;
export type FieldRelation = (typeof FIELD_RELATIONS)[number];

/** 回報公司的角色（company_supporting 由回報者在 supporting／porting 間選）。 */
export const FIELD_COMPANY_ROLES = ["developer", "publisher", "supporting", "porting"] as const;
export type FieldCompanyRole = (typeof FIELD_COMPANY_ROLES)[number];

/** field_correction 的值：平面物件，依欄位形狀只用其中幾個鍵（形狀見 domain/field-corrections.ts）。 */
export interface FieldCorrectionValue {
  /** text 形狀：新的文字，或 game_type／game_status 的字典值。 */
  text?: string;
  /** name／altName／localizedTitle／company 形狀的名稱。 */
  name?: string;
  /** altName：名稱註記。 */
  comment?: string;
  /** localizedTitle：BCP-47 語系代碼。 */
  locale?: string;
  /** company：角色。 */
  role?: FieldCompanyRole;
  /** link／media：http(s) 網址。 */
  url?: string;
  /** link：分類（例如 Official、Steam）。 */
  label?: string;
  /** ageRating：分級機構與分級。 */
  organization?: string;
  rating?: string;
  /** relation：關聯類型與對方遊戲。 */
  relation?: FieldRelation;
  gameName?: string;
  gameSlug?: string;
}

/** 提案內容（12）。所有欄位可省略；是否必填看 reportType（見 domain/report-validation.ts）。 */
export interface ReportProposed {
  gameId?: number;
  platformId?: number;
  regionCode?: string;
  /** `YYYY-MM-DD`；非 day 精度時代表「落在該期間內的任一天」，核可時才換算成代表日期與期間起點。 */
  date?: IsoDate;
  precision?: DatePrecision;
  stage?: ReleaseStage;
  /** 語言代碼（languages.code，BCP-47 優先）。 */
  language?: string;
  supportType?: LanguageSupportType;
  /** localized_title：繁中標題（trim 後 1～200 字）；locale 目前只允許 zh-Hant。 */
  title?: string;
  locale?: "zh-Hant";
  /** field_correction（D92）：欄位鍵、動作、新值，以及 change 時回報者指出要被取代的舊值。 */
  field?: FieldCorrectionKey;
  op?: FieldOp;
  value?: FieldCorrectionValue;
  oldValue?: FieldCorrectionValue;
}

export interface DataReport {
  id: number;
  targetType: ReportTargetType;
  targetId: number | null;
  reportType: ReportType;
  proposed: ReportProposed | null;
  sourceUrl: string | null;
  note: string | null;
  reporterUserId: number | null;
  /** 只存 HMAC 雜湊；超過 90 天由每日任務設為 NULL。 */
  reporterIpHash: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: Date | null;
  resolvedAt: Date | null;
}

/** 送出回報的已驗證輸入（Use Case 內部型別）。 */
export interface NewReportInput {
  targetType: ReportTargetType;
  targetId: number | null;
  reportType: ReportType;
  proposed: ReportProposed | null;
  sourceUrl: string | null;
  note: string | null;
  reporterUserId?: number | null;
  reporterIpHash: string | null;
}

/** 審核佇列一筆的「目標現況」。依 targetType 填對應欄位，找不到目標時 name 為 null。 */
export interface ReportTargetView {
  targetType: ReportTargetType;
  targetId: number | null;
  /** 顯示名稱（遊戲、平台、活動；release_event 為遊戲名＋平台）。 */
  name: string | null;
  /** 公開頁的路徑（不含語系前綴）：`/games/x`、`/platforms/x`、`/events/x`；找不到為 null。 */
  path: string | null;
  gameId: number | null;
  gameSlug: string | null;
  platformName: string | null;
  /** release_event 目標或提案地區的現況列（可能多筆：igdb、manual）。 */
  currentReleases: ReportReleaseView[];
  /** 目標遊戲目前的 zh-Hant 顯示標題（localized_title 比對用）；沒有為 null。 */
  currentTitle: string | null;
  /** field_correction（D92）：欄位標籤、動作文字、我方目前的值（核可時會存成舊值快照）與提案值；其他類型為 null。 */
  fieldCorrection: { label: string; igdbLocation: string; currentText: string; proposedText: string } | null;
}

export interface ReportReleaseView {
  releaseEventId: number;
  platformId: number;
  platformName: string;
  regionCode: string;
  stage: ReleaseStage;
  date: IsoDate | null;
  precision: DatePrecision;
  status: string;
  source: string;
  sequence: number;
}

/** 核可日期類回報時會寫入的 manual 上市列（預覽與實際寫入共用 domain/report-resolution.ts 的同一個計算）。 */
export interface ReportReleasePlanView {
  gameId: number;
  platformId: number;
  platformName: string;
  regionCode: string;
  stage: ReleaseStage;
  releaseDate: IsoDate | null;
  periodStart: IsoDate | null;
  precision: DatePrecision;
  status: string;
  /** 寫入後會被它取代顯示的現有列（同一個平台、地區、階段）；沒有則為 null。 */
  replaces: ReportReleaseView | null;
}

export interface ReportQueueItem {
  report: DataReport;
  target: ReportTargetView;
  /** wrong_date／missing_region_date 核可時會寫入的內容；其他類型或無法計算為 null。 */
  plan: ReportReleasePlanView | null;
  /** 同目標的其他回報（任何狀態，不含自己），新到舊。 */
  others: DataReport[];
  /** 核可後已建立的待回饋 IGDB 項目（D91）；沒有為 null。 */
  feedbackItem: { id: number; status: string } | null;
}
