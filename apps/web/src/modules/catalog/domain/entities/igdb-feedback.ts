// 待回饋 IGDB 清單（12 §待回饋 IGDB 清單，D91）。Domain 型別與 enum 值；零外部依賴。
import type { FieldCorrectionValue, FieldOp } from "./data-report";
import { FIELD_CORRECTION_KEYS } from "./data-report";
import type { DatePrecision, IsoDate, LanguageSupportType, ReleaseStage } from "./enums";

/** 可回饋的欄位鍵。新增欄位＝在 domain/igdb-feedback-fields.ts 加一筆登錄（值的形狀、建立、採納偵測）。 */
export const IGDB_FEEDBACK_FIELDS = [
  "release_date",
  "region_date",
  "stage",
  "language_support",
  "cancelled",
  "localized_title",
  ...FIELD_CORRECTION_KEYS,
] as const;
export type IgdbFeedbackField = (typeof IGDB_FEEDBACK_FIELDS)[number];

export const IGDB_FEEDBACK_STATUSES = ["pending", "submitted", "adopted", "skipped"] as const;
export type IgdbFeedbackStatus = (typeof IGDB_FEEDBACK_STATUSES)[number];

/** 管理者可手動做的動作（adopted 只由同步偵測設定）。 */
export const IGDB_FEEDBACK_ACTIONS = ["submit", "skip", "reopen"] as const;
export type IgdbFeedbackAction = (typeof IGDB_FEEDBACK_ACTIONS)[number];

/**
 * 舊值／新值（jsonb）。各欄位只用其中幾個鍵，由登錄表決定。
 * field_correction（D92）：newValue＝提案（op＋值的鍵，change 時可帶 replaces＝回報者指出要被取代的舊值）；
 * oldValue＝核可當下我方資料的快照（單值欄位用 text，多值欄位用 list）。
 */
export interface IgdbFeedbackValue extends FieldCorrectionValue {
  date?: IsoDate | null;
  precision?: DatePrecision;
  stage?: ReleaseStage;
  language?: string;
  supportType?: LanguageSupportType;
  /** release_events.status 或 games.gameStatus 的值。 */
  status?: string | null;
  title?: string | null;
  op?: FieldOp;
  replaces?: FieldCorrectionValue;
  /** 舊值快照：多值欄位目前的相關清單（已格式化成文字，過長截斷）。 */
  list?: string[];
}

/** 名稱＋字典 slug（類型、主題、平台、公司、品牌…）；名稱比對同時接受 slug。 */
export interface NamedFact {
  name: string;
  slug: string | null;
}

/**
 * 一款遊戲目前的資料（IGDB 同步而來）。核可 field_correction 時取來做舊值快照，同步後取來做「IGDB 已採納」比對（一組查詢，兩處共用）。
 * 純資料、零外部依賴；字串一律是原值（正規化在比對時做）。
 */
export interface GameFacts {
  igdbId: number;
  name: string;
  summary: string | null;
  storyline: string | null;
  gameType: string | null;
  gameStatus: string | null;
  coverUrl: string | null;
  trailerUrl: string | null;
  screenshotUrls: readonly string[];
  ageRatingLabel: string | null;
  alternativeNames: ReadonlyArray<{ name: string; comment: string | null }>;
  /** source='igdb' 的 game_localizations 名稱。 */
  localizationNames: readonly string[];
  genres: readonly NamedFact[];
  themes: readonly NamedFact[];
  gameModes: readonly NamedFact[];
  playerPerspectives: readonly NamedFact[];
  engines: readonly NamedFact[];
  franchises: readonly NamedFact[];
  collections: readonly NamedFact[];
  platforms: readonly NamedFact[];
  companies: ReadonlyArray<NamedFact & { role: string }>;
  /** source='igdb' 的外部連結網址。 */
  externalLinks: readonly string[];
  parent: NamedFact | null;
  versionParent: NamedFact | null;
  /** parent_game_id 指向本作的遊戲（DLC、擴充…）。 */
  children: ReadonlyArray<NamedFact & { gameType: string | null }>;
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
  /** 「IGDB 已採納」的判斷方式（說明文字；媒體欄位為「手動標記」）。 */
  adoptionRule: string;
  igdbUrl: string;
  oldText: string;
  newText: string;
  pasteText: string;
}
