/**
 * 時間軸：伺服器（頁面、route handler）與客戶端元件之間傳遞的資料。全部已格式化成字串，客戶端不需要字典。
 */

/** 一張卡（欄位名稱刻意縮短以減少 payload）。 */
export interface TimelineCardData {
  /** 組內唯一鍵：`${gameId}-${stage}`（同一組＝同日期＋精度，聚合規則保證同遊戲同階段只有一張）。 */
  k: string;
  /** 詳情頁網址 */
  h: string;
  /** 顯示名稱 */
  n: string;
  /** 原名（與顯示名稱不同時） */
  o?: string;
  /** 封面（ImageRef.small） */
  c?: string;
  /** 平台 chip 文字（有縮寫用縮寫） */
  p: string[];
  /** 平台全名（以語系的列舉格式串好，給 title／可及名稱） */
  pn: string;
  /** 階段 key 與文字 */
  sk: string;
  s: string;
  /** 精度不是 day 時的標示（「只確定月份」…） */
  pl?: string;
  /** 延期／取消（key 與文字） */
  tk?: string;
  t?: string;
  /** 資料來源待確認（sourceStatus = removed） */
  r?: 1;
  /** 熱度等級與文字（heatLevel 0 不給） */
  hv?: number;
  hl?: string;
  /** 有改期紀錄時：合併進卡片的 release_events.id（按需載入歷次日期） */
  ids?: number[];
}

export type TimelineGroupKind = "day" | "month" | "quarter" | "year" | "tbd";

export interface TimelineGroupData {
  /** TimelineGroup.key（`day:2026-10-13`、`month:2026-12-01`、`tbd`…）；跨頁合併與展開用。 */
  key: string;
  kind: TimelineGroupKind;
  periodStart: string | null;
  /** 月份區段鍵 `YYYY-MM`；tbd 為 null。 */
  month: string | null;
  /** 月份區段標題（「2026年10月」「日期未定」）。 */
  monthTitle: string;
  /** 組標題（「10月13日 星期二」「2026年12月（只確定月份）」）。 */
  title: string;
  cards: TimelineCardData[];
  /** 本組在目前篩選下的卡片總數。 */
  totalCount: number;
  /** 預設只顯示前 N 筆，其餘的數量（「展開（剩 M 款）」的 M）。 */
  hiddenCount: number;
  continuesFromPrev: boolean;
  continuesToNext: boolean;
}

/** 一頁時間軸（頁面初始資料與「載入更多／較早」的回應）。 */
export interface TimelineChunk {
  groups: TimelineGroupData[];
  nextCursor: string | null;
  prevCursor: string | null;
  /** true＝這次沒在掃描上限內湊滿，cursor 指向已掃描範圍的邊界（還有未掃描的範圍）；省略／false＝一般。 */
  nextPartial?: boolean;
  prevPartial?: boolean;
}

/** 「展開」的回應。 */
export interface TimelineGroupExpansion {
  key: string;
  cards: TimelineCardData[];
  totalCount: number;
  nextOffset: number | null;
}

/** 改期紀錄的回應：每張卡的歷次公告（舊到新，已格式化、去重）。 */
export interface TimelineHistoryResponse {
  entries: string[];
}

/** 客戶端元件用的字串（{count} 由客戶端代入）。 */
export interface TimelineClientLabels {
  loadMore: string;
  loadEarlier: string;
  loading: string;
  /** 含 {count} */
  expand: string;
  /** 含 {group}、{count}（按鈕的可及名稱） */
  expandAria: string;
  /** 含 {count} */
  loadedCount: string;
  loadError: string;
  noEarlier: string;
  noLater: string;
  /** 部分結果：掃描範圍內沒有更多，還能繼續找（與 noEarlier／noLater 的「到盡頭」區分） */
  partialEarlier: string;
  partialLater: string;
  searchEarlier: string;
  searchLater: string;
  today: string;
  /** 「今天」線上的日期文字（已格式化） */
  todayDate: string;
  history: string;
  historyLoading: string;
  historyError: string;
  historyEmpty: string;
  sourceUnconfirmed: string;
  platforms: string;
  listLabel: string;
}
