/**
 * 日期與數字格式化（spec 06 §多語系 §格式化）。只用 Intl。
 *
 * 純日期（`YYYY-MM-DD`，上市日）一律以 `timeZone: "UTC"` 格式化：日期字串被解讀成 UTC 午夜，
 * 若用執行環境時區（例如 UTC-8）顯示就會跑成前一天。時間點（活動）才依使用者時區。
 */
import { intlLocale, type Locale } from "./locales";
import { MESSAGES, lookupMessage } from "./messages";
import { interpolate } from "./translator";

/**
 * 上市日精度。值必須與 catalog domain 的 `DATE_PRECISIONS`
 * （apps/web/src/modules/catalog/domain/entities/enums.ts）相同——套件不能 import apps，
 * 由 apps/web 端做型別相等斷言。
 */
export const RELEASE_DATE_PRECISIONS = ["day", "month", "quarter", "year", "tbd"] as const;
export type ReleaseDatePrecision = (typeof RELEASE_DATE_PRECISIONS)[number];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  year: number;
  month: number; // 1~12
  day: number;
  utc: Date;
}

/** 解析 `YYYY-MM-DD`；不合法（含 2026-02-30 這種不存在的日期）回傳 null。 */
export function parseIsoDate(date: string): DateParts | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, month, day, utc };
}

function template(locale: Locale, name: "quarter" | "year" | "tbd"): string {
  return lookupMessage(MESSAGES[locale].ui, `releaseLabel.${name}`) ?? name;
}

/**
 * 純日期格式化（固定 UTC）。options 的 timeZone 一律被覆寫成 UTC。
 * 預設 `dateStyle: "long"`：zh-Hant「2027年5月3日」、en「May 3, 2027」。不合法的日期回傳原字串。
 */
export function formatIsoDate(
  date: string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  const p = parseIsoDate(date);
  if (!p) return date;
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" }).format(p.utc);
}

/**
 * 上市日標籤（spec 06）：
 * - day → `dateStyle: "long"`；month → `{ year, month: "long" }`（皆 UTC）
 * - quarter／year → 字典樣板 `ui.releaseLabel.*`；季由 date 的月份推算（季／年精度的 date 是期間最後一天）
 * - tbd，或 date 為 null／不合法 → `ui.releaseLabel.tbd`
 */
export function formatReleaseLabel(date: string | null, precision: ReleaseDatePrecision, locale: Locale): string {
  const p = precision === "tbd" || date == null ? null : parseIsoDate(date);
  if (!p) return template(locale, "tbd");
  switch (precision) {
    case "day":
      return formatIsoDate(date as string, locale, { dateStyle: "long" });
    case "month":
      return formatIsoDate(date as string, locale, { year: "numeric", month: "long" });
    case "quarter":
      return interpolate(template(locale, "quarter"), { year: String(p.year), quarter: String(Math.floor((p.month - 1) / 3) + 1) }, locale);
    case "year":
      return interpolate(template(locale, "year"), { year: String(p.year) }, locale);
    default:
      return template(locale, "tbd");
  }
}

/** 月曆標題等：`{ year, month: "long" }`（UTC）。month 為 1~12。 */
export function formatYearMonth(year: number, month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { year: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * 星期名稱（月曆表頭）。weekStartsOn：0 = 星期日、1 = 星期一。
 * width：`short`（zh-Hant「週日」、en「Sun」）、`narrow`（「日」「S」）、`long`。
 */
export function weekdayNames(
  locale: Locale,
  width: "long" | "short" | "narrow" = "short",
  weekStartsOn: 0 | 1 = 0,
): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: width, timeZone: "UTC" });
  // 2026-01-04 是星期日
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 0, 4 + weekStartsOn + i))));
}

/** 數字（Intl.NumberFormat）。例：`formatNumber(12345, "en", { notation: "compact" })` → `12K`。 */
export function formatNumber(n: number | bigint, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(n);
}

/**
 * 時間點（活動開始時間等）依使用者時區顯示（與語系無關）。isoInstant 例：`2026-06-08T17:00:00Z`。
 * 預設含時區縮寫：en「Jun 8, 2026, 10:00 AM PDT」。不合法的輸入回傳原字串。
 */
export function formatDateTime(
  isoInstant: string,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
): string {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return isoInstant;
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone }).format(d);
}

export interface EventTimeText {
  start: string;
  /** 沒有結束、或與開始相同時為 null；與開始同一天（在該時區）時只含時間。 */
  end: string | null;
}

const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };

function dayKeyInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * 活動時間（開始，選填結束）依 `timeZone` 格式化——活動時間顯示的唯一實作。
 * 結束與開始在**該時區**同一天 → 結束只顯示時間（所以同一場活動換時區後，是否跨日可能不同）。
 * 時區不合法（Intl 丟 RangeError）→ 退回 UTC。不合法的時間字串原樣回傳。
 */
export function formatEventTimeText(startIso: string, endIso: string | null, locale: Locale, timeZone: string): EventTimeText {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const start = formatDateTime(startIso, locale, zone);
  const s = new Date(startIso);
  const e = endIso ? new Date(endIso) : null;
  if (!e || Number.isNaN(e.getTime()) || Number.isNaN(s.getTime()) || e.getTime() === s.getTime()) return { start, end: null };
  const sameDay = dayKeyInZone(s, zone) === dayKeyInZone(e, zone);
  return { start, end: formatDateTime(endIso as string, locale, zone, sameDay ? TIME_ONLY : undefined) };
}
