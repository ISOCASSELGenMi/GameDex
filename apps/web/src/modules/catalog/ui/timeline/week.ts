/**
 * 時間軸「週」的純函式（無 React、無 DB）。週一起算的 ISO 週（`2026-W43`），日期一律以 UTC 計算。
 * 週起始日不跟語系走：網址 `week=2026-W43` 必須對所有語系是同一段日子（可分享）。
 */
import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from "../month";

const DAY_MS = 86_400_000;
const WEEK_PARAM = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(date: string): Date | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date ? d : null;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 加減天數；超出可用年份範圍（1900~2200）→ null。 */
export function addDays(date: string, delta: number): string | null {
  const d = toUtc(date);
  if (!d) return null;
  const out = new Date(d.getTime() + delta * DAY_MS);
  const y = out.getUTCFullYear();
  if (y < MIN_CALENDAR_YEAR || y > MAX_CALENDAR_YEAR) return null;
  return iso(out);
}

/** 某日所在週的星期一（YYYY-MM-DD）。 */
export function weekStartOf(date: string): string | null {
  const d = toUtc(date);
  if (!d) return null;
  const back = (d.getUTCDay() + 6) % 7; // 週一 = 0
  return iso(new Date(d.getTime() - back * DAY_MS));
}

/** 某日所在週的 ISO 週參數（`2026-W43`；ISO 週年以該週的星期四為準，所以 12 月底可能屬於下一年）。 */
export function isoWeekOf(date: string): string | null {
  const start = weekStartOf(date);
  const s = start ? toUtc(start) : null;
  if (!s) return null;
  const thursday = new Date(s.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

/** `week=2026-W43` → 該週星期一的日期；格式錯、該年沒有這一週、超出範圍 → null。 */
export function parseWeekParam(value: string): string | null {
  const m = WEEK_PARAM.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR) return null;
  // 1 月 4 日一定在第 1 週
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOfWeek1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const start = iso(new Date(mondayOfWeek1 + (week - 1) * 7 * DAY_MS));
  // 往返不一致 → 這一年沒有第 53 週
  return isoWeekOf(start) === value ? start : null;
}

/**
 * 網址明確指定的那一週（星期一）：`week` 合法 → 該週；否則 `at` 合法 → 該日所在週；都沒有 → null（= 今天所在週）。
 * 伺服器（resolveWeekStart）與 client 同步網址共用這一份規則。
 */
export function explicitWeekStart(week: string | null | undefined, at: string | null | undefined): string | null {
  const fromWeek = week ? parseWeekParam(week) : null;
  if (fromWeek) return fromWeek;
  return at ? weekStartOf(at) : null;
}

/** 一週的七天（從 start 起）。 */
export function weekDays(start: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (d) out.push(d);
  }
  return out;
}
