// 時間軸讀取模型（Phase 3b，06 §時間軸）。Domain 型別，零外部依賴。
import type { DatePrecision, IsoDate } from "./enums";
import type { IgnoredFilterValue, ReleaseCard, ReleaseDateChange } from "./read-models";

/** 每組（每天／每個模糊期間）預設顯示前幾筆，其餘以「展開」取得（06 §時間軸）。 */
export const TIMELINE_GROUP_PREVIEW = 10;
/** 一頁最多幾張卡（只算顯示的卡，不含被每組前 N 筆截掉的）。 */
export const TIMELINE_PAGE_SIZE = 60;
export const TIMELINE_PAGE_SIZE_MAX = 200;
/** 展開某組一次最多取幾張。 */
export const TIMELINE_GROUP_PAGE_MAX = 200;

/**
 * 時間軸的一組：
 * - `day`：某一天（periodStart＝date＝當日）
 * - `month`／`quarter`／`year`：模糊日期，放在所屬期間的頂端區塊（「2026 年 12 月」「2027 Q2」「2027 年」）
 * - `tbd`：最後的「未定」
 * 同一個 periodStart 時，排序是 year → quarter → month → day（粗的在上，才會落在期間頂端）。
 */
export interface TimelineGroup {
  /** 穩定的組鍵：`day:2026-10-13`、`month:2026-12-01`、`quarter:2027-04-01`、`year:2027-01-01`、`tbd`。展開某組用。 */
  key: string;
  kind: DatePrecision;
  /** 期間起點；tbd 為 null。 */
  periodStart: IsoDate | null;
  /** 所屬月份區段 `YYYY-MM`（periodStart 的月份；季／年區塊歸到期間第一個月）；tbd 為 null。UI 依此分「月 → 日」。 */
  month: string | null;
  /** 這一頁裡屬於本組的卡（popularityScore 由高到低，同分依 gameId），只含前 TIMELINE_GROUP_PREVIEW 筆中落在本頁的部分。 */
  cards: ReleaseCard[];
  /** 本組在目前篩選下的卡片總數。 */
  totalCount: number;
  /** 因「每組只顯示前 N 筆」而沒出現的數量（＝max(0, totalCount − N)），UI 顯示「展開（＋n）」。 */
  hiddenCount: number;
  /** 本組有卡在前一頁（頁界切在組中間）；UI 合併同 key 的組。 */
  continuesFromPrev: boolean;
  /** 本組還有預覽卡在下一頁。 */
  continuesToNext: boolean;
}

export interface TimelinePage {
  /** 依時間由早到晚。 */
  groups: TimelineGroup[];
  /** 載入更多（往後）；null＝沒有了。 */
  nextCursor: string | null;
  /** 往前載入；null＝沒有了（第一頁時只確認全庫最早日期，可能載入後為空）。 */
  prevCursor: string | null;
  /** 今天（UTC），UI 畫「今天」線。 */
  today: IsoDate;
  /** 起點（未給 cursor 時＝指定日期或今天；給 cursor 時為 null）。 */
  anchor: IsoDate | null;
  /** 每組預覽筆數（TIMELINE_GROUP_PREVIEW）。 */
  groupPreview: number;
  /** 被忽略的篩選值。 */
  ignored: IgnoredFilterValue[];
}

/** 展開某組的結果。 */
export interface TimelineGroupCards {
  key: string;
  cards: ReleaseCard[];
  totalCount: number;
  /** 下一段的 offset；null＝沒有了。 */
  nextOffset: number | null;
  ignored: IgnoredFilterValue[];
}

/** 一個上市列的歷次改期（release_date_history，舊到新）。 */
export interface ReleaseEventDateHistory {
  releaseEventId: number;
  changes: ReleaseDateChange[];
}
