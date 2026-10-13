/**
 * 網址產生（純函式）。所有站內連結都經這裡，語系前綴與篩選 query 的處理只寫一次。
 */
import { filterSpecToQueryString, type FilterSpec } from "@sok/api-contract";
import { localeSelfName, type Locale } from "@sok/i18n";
import { formatMonthParam, type YearMonth } from "./month";

/** 去掉語系前綴後的路徑，一律以 `/` 開頭（`/calendar/2026-10`）；根目錄為 `/`。 */
export type LocalPath = string;

export function withQuery(path: string, query: string): string {
  const q = query.startsWith("?") ? query.slice(1) : query;
  return q ? `${path}?${q}` : path;
}

export function localeHref(locale: Locale, path: LocalPath, query = ""): string {
  const p = path === "/" ? "" : path;
  return withQuery(`/${locale}${p}`, query);
}

export function calendarMonthPath(ym: YearMonth): LocalPath {
  return `/calendar/${formatMonthParam(ym)}`;
}

export function calendarMonthHref(locale: Locale, ym: YearMonth, filter: FilterSpec = {}): string {
  return localeHref(locale, calendarMonthPath(ym), filterSpecToQueryString(filter));
}

/** 「今天」：不帶月份，由 /calendar 導到當月（保留篩選）。 */
export function calendarTodayHref(locale: Locale, filter: FilterSpec = {}): string {
  return localeHref(locale, "/calendar", filterSpecToQueryString(filter));
}

export function gameHref(locale: Locale, slug: string): string {
  return localeHref(locale, `/games/${encodeURIComponent(slug)}`);
}

export interface LanguageLink {
  locale: Locale;
  href: string;
  /** 以該語言自稱顯示（繁體中文／English）。 */
  label: string;
  current: boolean;
}

/** 語言選單：同一路徑與 query，只換語系前綴。 */
export function languageMenuLinks(
  current: Locale,
  supported: readonly Locale[],
  path: LocalPath,
  query = "",
): LanguageLink[] {
  return supported.map((locale) => ({
    locale,
    href: localeHref(locale, path, query),
    label: localeSelfName(locale),
    current: locale === current,
  }));
}

/** 把 Next 的 searchParams 物件轉回 query 字串（保留原樣，給語言選單用）。 */
export function searchParamsToQuery(sp: Readonly<Record<string, string | string[] | undefined>>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) usp.append(k, item);
    else usp.append(k, v);
  }
  return usp.toString().replace(/%2C/gi, ",");
}
