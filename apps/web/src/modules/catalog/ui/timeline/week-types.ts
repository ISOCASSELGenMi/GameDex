/**
 * 時間軸（週）：伺服器（頁面、route handler）與客戶端元件之間傳遞的資料。全部已格式化成字串，客戶端不需要字典。
 */
import type { DayCardData } from "../calendar/types";

/** 週內有遊戲上市的一天。 */
export interface WeekDayData {
  /** YYYY-MM-DD */
  date: string;
  /** 日期數字（1~31） */
  dayNum: number;
  /** 星期短名稱（「週一」「Mon」） */
  weekday: string;
  /** 完整日期（節點的可及名稱：「10月19日 星期一」） */
  title: string;
  /** 卡片群組的可及名稱（日期＋款數） */
  label: string;
  /** 當日上市總數 */
  total: number;
  /** 當日第一款（其餘由 day API 按需載入） */
  first: DayCardData;
}

export interface WeekNavLink {
  /** `2026-W43` */
  week: string;
  href: string;
  /** 可及名稱（「上一週：10月12日–10月18日」，含可見文字） */
  aria: string;
}

export interface TimelineWeekData {
  /** `2026-W43` */
  week: string;
  /** 週一／週日（YYYY-MM-DD） */
  start: string;
  end: string;
  /** 「10月19日–10月25日」 */
  range: string;
  /** 今天（UTC，YYYY-MM-DD） */
  today: string;
  /** 今天在本週內 */
  todayInWeek: boolean;
  /** 「今天」線上的文字（已格式化的日期） */
  todayText: string;
  /** 本週網址（可分享：含篩選與 week） */
  href: string;
  /** 回到今天（不帶 week，由伺服器決定今天所在週） */
  todayHref: string;
  prev: WeekNavLink | null;
  next: WeekNavLink | null;
  days: WeekDayData[];
  /** 本週上市總數（跨日加總） */
  total: number;
  /** 載入完成的即時宣告（「已載入 10月19日–10月25日，共 24 款上市」） */
  announce: string;
}

/** 客戶端元件用的字串（{count} 由客戶端代入）。 */
export interface TimelineWeekLabels {
  prevWeek: string;
  nextWeek: string;
  today: string;
  weekNavigation: string;
  jumpTo: string;
  jumpGo: string;
  jumpHint: string;
  /** 含 {count} */
  releasesCount: string;
  empty: string;
  loading: string;
  loadError: string;
  dayPrev: string;
  dayNext: string;
  dayCurrent: string;
  dayLoadError: string;
  dayRetry: string;
  /** 「今天」的短標示（a11y.today） */
  todayTag: string;
}
