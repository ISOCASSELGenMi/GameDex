/**
 * 月曆的純函式（無 React、無 DB）：月份參數、月曆格、＋N 折疊、週起始日。
 * 純日期一律以 UTC 計算（與 @sok/i18n 的 formatReleaseLabel 一致）。
 */

export interface YearMonth {
  year: number;
  /** 1~12 */
  month: number;
}

/** getCalendarMonth 接受的年份範圍。 */
export const MIN_CALENDAR_YEAR = 1900;
export const MAX_CALENDAR_YEAR = 2200;

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `/calendar/[yyyy-mm]` 的參數；格式錯或超出範圍 → null（頁面回 404）。 */
export function parseMonthParam(value: string): YearMonth | null {
  const m = MONTH_PARAM.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR) return null;
  return { year, month };
}

export function formatMonthParam({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** 加減月份（可跨年）；超出 1900~2200 → null（不產生連結）。 */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth | null {
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  if (y < MIN_CALENDAR_YEAR || y > MAX_CALENDAR_YEAR) return null;
  return { year: y, month: m };
}

/** UTC 的「今天」所在月份。 */
export function monthOfDate(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 = 週日、1 = 週一。 */
export type WeekStart = 0 | 1;

/**
 * 各語系的週起始日（可設定）。目前 zh-Hant、en 都是週日；未列出的語系用 DEFAULT_WEEK_START。
 * ja（Phase 3.5）若要改週一起，在這裡加一行即可。
 */
export const WEEK_START_BY_LOCALE: Readonly<Record<string, WeekStart>> = {
  "zh-Hant": 0,
  en: 0,
};
export const DEFAULT_WEEK_START: WeekStart = 0;

export function weekStartFor(locale: string): WeekStart {
  return WEEK_START_BY_LOCALE[locale] ?? DEFAULT_WEEK_START;
}

/** 月曆格：每列 7 格；不屬於本月的格子是 null。 */
export interface MonthGrid {
  weeks: (string | null)[][];
  /** 月首日前面空幾格（0~6）。 */
  leading: number;
}

export function buildMonthGrid(ym: YearMonth, weekStartsOn: WeekStart): MonthGrid {
  const firstWeekday = new Date(Date.UTC(ym.year, ym.month - 1, 1)).getUTCDay(); // 0 = 週日
  const leading = (firstWeekday - weekStartsOn + 7) % 7;
  const total = daysInMonth(ym);
  const cells: (string | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(isoDate(ym.year, ym.month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, leading };
}

/** 週幾（0 = 週日）。 */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ＋N 折疊：前 limit 筆顯示，其餘折疊；hidden 為折疊的筆數。 */
export function foldItems<T>(items: readonly T[], limit: number): { visible: T[]; folded: T[]; hidden: number } {
  const n = Math.max(0, Math.floor(limit));
  if (items.length <= n) return { visible: [...items], folded: [], hidden: 0 };
  return { visible: items.slice(0, n), folded: items.slice(n), hidden: items.length - n };
}

/** 格子內最多顯示幾項（其餘「＋N」）。 */
export const CELL_VISIBLE_ITEMS = 3;
/** 手機議程式清單每天最多顯示幾項（其餘展開）。 */
export const AGENDA_VISIBLE_ITEMS = 5;
/** 「本月未定日」每組超過這個數量就預設收合。 */
export const UNDATED_OPEN_MAX = 24;
