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

/** 時間軸 `/timeline`；`at`＝跳到指定日期（YYYY-MM-DD）。篩選參數在前、`at` 在後（與 proxy 正規形式一致）。 */
export function timelineHref(locale: Locale, filter: FilterSpec = {}, at?: string | null): string {
  const q = [filterSpecToQueryString(filter), at ? `at=${encodeURIComponent(at)}` : ""].filter(Boolean).join("&");
  return localeHref(locale, "/timeline", q);
}

/** 熱門榜 `/trending`；group＝upcoming（預設，不寫進網址）／released。 */
export function trendingHref(locale: Locale, filter: FilterSpec = {}, group: "upcoming" | "released" = "upcoming", page = 1): string {
  const extra: string[] = [];
  if (group !== "upcoming") extra.push(`group=${group}`);
  if (page > 1) extra.push(`page=${page}`);
  const q = [filterSpecToQueryString(filter), ...extra].filter(Boolean).join("&");
  return localeHref(locale, "/trending", q);
}

export function gameHref(locale: Locale, slug: string): string {
  return localeHref(locale, `/games/${encodeURIComponent(slug)}`);
}

function pageQuery(extra: string[], page?: number): string {
  const parts = [...extra];
  if (page && page > 1) parts.push(`page=${page}`);
  return parts.join("&");
}

export function platformsHref(locale: Locale): string {
  return localeHref(locale, "/platforms");
}

/** 第 4 個參數（可省略）：section 預設 upcoming、sort 預設 date，預設值不寫入網址。 */
export function platformHref(
  locale: Locale,
  slug: string,
  page?: number,
  opts: { section?: "upcoming" | "recent"; sort?: "date" | "popularity" } = {},
): string {
  const extra: string[] = [];
  if (opts.section && opts.section !== "upcoming") extra.push(`section=${opts.section}`);
  if (opts.sort && opts.sort !== "date") extra.push(`sort=${opts.sort}`);
  return localeHref(locale, `/platforms/${encodeURIComponent(slug)}`, pageQuery(extra, page));
}

/** 第 4 個參數（可省略）：role 角色篩選（developer／publisher／porting／supporting），省略＝全部。 */
export function companyHref(locale: Locale, slug: string, page?: number, opts: { role?: string | null } = {}): string {
  const extra = opts.role ? [`role=${encodeURIComponent(opts.role)}`] : [];
  return localeHref(locale, `/companies/${encodeURIComponent(slug)}`, pageQuery(extra, page));
}

/** kind 預設 franchise 與 page=1 不寫入網址。 */
export function franchiseHref(
  locale: Locale,
  slug: string,
  kind: "franchise" | "collection" = "franchise",
  page?: number,
): string {
  return localeHref(
    locale,
    `/franchises/${encodeURIComponent(slug)}`,
    pageQuery(kind === "collection" ? ["kind=collection"] : [], page),
  );
}

export interface EventsHrefOptions {
  /** 活動類型（EventKind 值：showcase/expo/awards/other）。 */
  kind?: string;
  /** 時間範圍：upcoming（預設，不寫入）／past／undated（時間未定）。 */
  when?: "upcoming" | "past" | "undated";
  page?: number;
}

export function eventsHref(locale: Locale, opts: EventsHrefOptions = {}): string {
  const extra: string[] = [];
  if (opts.kind) extra.push(`kind=${encodeURIComponent(opts.kind)}`);
  if (opts.when && opts.when !== "upcoming") extra.push(`when=${opts.when}`);
  return localeHref(locale, "/events", pageQuery(extra, opts.page));
}

export function eventHref(locale: Locale, slug: string): string {
  return localeHref(locale, `/events/${encodeURIComponent(slug)}`);
}

/**
 * 遊戲瀏覽／搜尋 `/games`。篩選參數（含 q、sort；順序同 FILTER_PARAMS）在前，`page`（第 1 頁不寫入）在後，
 * 與 proxy 的正規形式一致。
 */
export function gamesBrowseHref(locale: Locale, filter: FilterSpec = {}, page = 1): string {
  const q = [filterSpecToQueryString(filter), page > 1 ? `page=${Math.floor(page)}` : ""].filter(Boolean).join("&");
  return localeHref(locale, "/games", q);
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

// ── Phase 5：iCal（08）──────────────────────────────────────────────────────

/** 訂閱頁 `/[locale]/subscribe`。 */
export function subscribeHref(locale: Locale): string {
  return localeHref(locale, "/subscribe");
}

/** 法務與說明頁 `/about/{data-sources,privacy,terms,contact}`。 */
export function aboutHref(locale: Locale, page: "data-sources" | "privacy" | "terms" | "contact"): string {
  return localeHref(locale, `/about/${page}`);
}

/**
 * 公開 feed 的站內路徑（不含語系以外的前綴；不經 localeHref，因為 /ical 不是頁面路由、語系在 /ical 之後）：
 * `/ical/{locale}/releases.ics`、`/ical/{locale}/events.ics`、`/ical/{locale}/platform/{slug}.ics`、`/ical/{locale}/game/{slug}.ics`。
 * slug 會做 URL 編碼（`{slug}` 樣板字串原樣保留，給客戶端元件替換）。
 */
export function icalFeedPath(locale: Locale, kind: "releases" | "events"): string;
export function icalFeedPath(locale: Locale, kind: "platform" | "game", slug: string): string;
export function icalFeedPath(locale: Locale, kind: "releases" | "events" | "platform" | "game", slug?: string): string {
  if (kind === "releases" || kind === "events") return `/ical/${locale}/${kind}.ics`;
  const s = slug === "{slug}" ? slug : encodeURIComponent(slug ?? "");
  return `/ical/${locale}/${kind}/${s}.ics`;
}
