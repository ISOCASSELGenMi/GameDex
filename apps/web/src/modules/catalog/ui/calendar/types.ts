/**
 * 月曆伺服器元件與客戶端增強元件之間傳遞的資料（全部已格式化成字串，客戶端不需要字典）。
 */

/** 預覽卡資料（key 是卡片在本月清單中的序號，36 進位）。欄位名稱刻意縮短以減少 RSC payload。 */
export interface PreviewCardData {
  /** 詳情頁網址 */
  h: string;
  /** 顯示名稱 */
  n: string;
  /** 原名（與顯示名稱不同時才有） */
  o?: string;
  /** 封面網址（ImageRef.medium，已由 Provider 解析好） */
  c?: string;
  /** 上市日文字（formatReleaseLabel） */
  d: string;
  /** 平台（以語系的列舉格式串好） */
  p: string;
  /** 上市階段 key 與文字 */
  sk: string;
  s: string;
  /** 狀態 key 與文字（scheduled 以外才有） */
  tk?: string;
  t?: string;
  /** 資料來源待確認（sourceStatus = removed） */
  r?: 1;
  /** 折疊清單用：平台縮寫（「PS5 · Switch」） */
  a?: string;
  /** 折疊清單用：附註（非正式版階段、延期／取消、資料來源待確認），已含括號 */
  x?: string;
  /** 熱度等級（1~5；0 不給）與文字（「熱度 4/5」） */
  hv?: number;
  hl?: string;
}

/** 月曆格上的標籤（階段、狀態、遊戲類型、來源待確認）。k＝種類、i＝圖示 key（階段或狀態 key）、l＝文字。 */
export interface CardTag {
  k: "stage" | "status" | "type" | "warn";
  i?: string;
  l: string;
}

/**
 * 月曆格內一款遊戲的資料（伺服器首屏只送每天第一款；其餘由 day API 按需載入，兩者同一個形狀、同一份建構函式）。
 * 繼承預覽卡欄位（點封面開側邊預覽時直接用），已全部格式化成字串，客戶端不需要字典。
 */
export interface DayCardData extends PreviewCardData {
  /** gameId（追蹤按鈕的掛載點用） */
  id: number;
  /** 名稱的 lang 屬性（顯示的是外文原名時才有） */
  nl?: string;
  /** 平台縮寫 chip（最多 3 個）與其餘平台數量 */
  pc: string[];
  pn?: number;
  /** 標籤（最多 3 個） */
  tg: CardTag[];
}

/** GET /api/v1/calendar/day 的回應。 */
export interface CalendarDayResponse {
  date: string;
  total: number;
  cards: DayCardData[];
}

/** 折疊清單（大量未定日）的一列：[詳情頁網址, 顯示名稱, 平台縮寫, 附註]。用陣列而非物件，整月上百筆時 RSC payload 小一半。 */
export type FoldRow = readonly [href: string, name: string, abbr: string, note: string];

export interface CalendarClientLabels {
  close: string;
  viewGame: string;
  previewTitle: string;
  platforms: string;
  date: string;
  stage: string;
  status: string;
  originalName: string;
  sourceUnconfirmed: string;
  event: string;
  release: string;
}

/** 月曆格（DayCell）的文字；含 {index}／{total}／{name} 的是樣板，客戶端以字串取代。 */
export interface DayCellLabels {
  /** 「上一款，第 {index}／{total} 款」 */
  prev: string;
  /** 「下一款，第 {index}／{total} 款」 */
  next: string;
  /** 即時宣告：「{name}，第 {index}／{total} 款」 */
  current: string;
  today: string;
  loadError: string;
  retry: string;
}
