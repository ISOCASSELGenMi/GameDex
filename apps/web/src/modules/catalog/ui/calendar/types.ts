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

export interface CalendarClientLabels {
  close: string;
  backToList: string;
  viewGame: string;
  previewTitle: string;
  /** 含 {date} */
  dayDialogTitle: string;
  platforms: string;
  date: string;
  stage: string;
  status: string;
  originalName: string;
  sourceUnconfirmed: string;
  event: string;
  release: string;
}
