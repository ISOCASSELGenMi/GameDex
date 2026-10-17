/**
 * 追蹤與「我的遊戲」畫面的純函式（客戶端與測試共用）：目標連結、上市日標籤、mine 參數、日期範圍檢查。
 * 日期標籤的格式與 `formatReleaseLabel`（@sok/i18n）一致，但不 import 該套件（那會把整份字典打包進客戶端）；
 * 單元測試逐一比對三個語系與五種精度，兩邊不一致會失敗。
 */
import type { FollowTarget } from "../domain/entities/follows";
import { str } from "./str";
import type { AccountStrings } from "./strings";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(date: string): { year: number; month: number; utc: Date } | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, month, utc };
}

export type ReleasePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/** 上市日標籤：day＝長日期；month＝年月；quarter／year＝字典樣板；tbd 或日期不合法＝「日期未定」。 */
export function formatMyGameDate(strings: AccountStrings, locale: string, date: string | null, precision: ReleasePrecision): string {
  const p = precision === "tbd" || date == null ? null : parseIso(date);
  if (!p) return str(strings, "mygames.date.tbd");
  switch (precision) {
    case "day":
      return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(p.utc);
    case "month":
      return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(p.utc);
    case "quarter":
      return str(strings, "mygames.date.quarter", { year: String(p.year), quarter: String(Math.floor((p.month - 1) / 3) + 1) });
    case "year":
      return str(strings, "mygames.date.year", { year: String(p.year) });
    default:
      return str(strings, "mygames.date.tbd");
  }
}

/** 追蹤目標的頁面連結（客戶端與測試共用；語系前綴 `/{locale}`）。franchise 的 collection 用 `?kind=collection`。 */
export function followTargetHref(locale: string, target: { targetType: FollowTarget; slug: string; kind?: string | null }): string {
  const slug = encodeURIComponent(target.slug);
  switch (target.targetType) {
    case "game":
      return `/${locale}/games/${slug}`;
    case "event":
      return `/${locale}/events/${slug}`;
    case "platform":
      return `/${locale}/platforms/${slug}`;
    case "franchise":
      return `/${locale}/franchises/${slug}${target.kind === "collection" ? "?kind=collection" : ""}`;
    case "company":
      return `/${locale}/companies/${slug}`;
  }
}

/** 「我的遊戲」來源選擇 → API 的 mine 參數值；不合法回 null。 */
export function mineValue(source: string): string | null {
  if (source === "followed" || source === "owned" || source === "collected") return source;
  return /^list:[1-9][0-9]{0,9}$/.test(source) ? source : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 日期範圍輸入檢查：空字串視為未填；格式不對或 to < from → 錯誤碼。 */
export function checkDateRange(from: string, to: string): "invalid" | "before_from" | null {
  if ((from !== "" && !DATE_RE.test(from)) || (to !== "" && !DATE_RE.test(to))) return "invalid";
  if (from !== "" && to !== "" && to < from) return "before_from";
  return null;
}

/** 一行顯示用的簡短日期時間（上次讀取時間；依瀏覽器時區）。 */
export function formatLocalDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** 遮罩後的私人訂閱網址：保留來源與路徑前綴，token 以圓點取代（token 不會出現在遮罩字串內）。 */
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}/ical/u/${"•".repeat(12)}`;
  } catch {
    return "•".repeat(24);
  }
}
