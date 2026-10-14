/**
 * canonical 與 hreflang 的唯一實作（06 §SEO 與快取、15 Phase 3.5）。純函式，語系清單由呼叫端傳入
 * （來自 SUPPORTED_LOCALES，不寫死語系數）。
 *
 * 規則：
 * 1. 每個語系獨立網址；canonical 一律是「自己這個語系」的正規網址（自我參照），不跨語系。
 * 2. alternates 列出所有支援語系（含自己），再加 `x-default`＝預設語系的網址。
 * 3. 正規網址的 query：只保留該頁面的「正規參數」（見各頁面的 rules）；篩選、排序、檢視切換一律去掉，
 *    讓所有變體收斂到同一個網址（最保守；spec 06 沒有明講篩選頁的 canonical，列為待決）。
 */
import { intlLocale, type Locale } from "@sok/i18n";
import { absoluteUrl } from "./site-url";

/** 去掉語系前綴的路徑，以 `/` 開頭；根目錄為 `/`。 */
type LocalPath = string;

export interface AlternatesInput {
  /** 站台 origin；null → 輸出相對網址。 */
  origin: string | null;
  locale: Locale;
  supported: readonly Locale[];
  defaultLocale: Locale;
  path: LocalPath;
  /** 正規 query（不含 `?`）；沒有給或空字串＝無 query。 */
  query?: string;
}

export interface PageAlternates {
  /** 本頁（本語系）的正規網址。 */
  canonical: string;
  /** hreflang → 網址；含各支援語系與 `x-default`。 */
  languages: Record<string, string>;
}

/** hreflang 值：BCP 47 標籤（`zh-Hant`、`en`、`ja`）。集中一處以便日後調整（例如 zh-Hant → zh-TW）。 */
export function hreflangOf(locale: Locale): string {
  return intlLocale(locale);
}

/** 某語系的絕對（或相對）網址。 */
export function localizedUrl(origin: string | null, locale: Locale, path: LocalPath, query = ""): string {
  const p = path === "/" ? "" : path;
  const q = query.startsWith("?") ? query.slice(1) : query;
  return absoluteUrl(origin, `/${locale}${p}${q ? `?${q}` : ""}`);
}

export function buildAlternates(input: AlternatesInput): PageAlternates {
  const query = input.query ?? "";
  const languages: Record<string, string> = {};
  for (const l of input.supported) languages[hreflangOf(l)] = localizedUrl(input.origin, l, input.path, query);
  languages["x-default"] = localizedUrl(input.origin, input.defaultLocale, input.path, query);
  return { canonical: localizedUrl(input.origin, input.locale, input.path, query), languages };
}

// ── canonical query ───────────────────────────────────────────────────────

export type RawSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** 正規參數規則：`normalize` 回 null＝該參數不進正規網址（預設值或無效值）。 */
export interface QueryRule {
  name: string;
  normalize(raw: string): string | null;
}

/** 分頁：只保留 2 以上的整數（第 1 頁＝無參數）。 */
export const PAGE_RULE: QueryRule = {
  name: "page",
  normalize: (raw) => (/^\d{1,6}$/.test(raw) && Number(raw) > 1 ? String(Number(raw)) : null),
};

/** 取固定值才保留的參數（例如系列頁 `kind=collection`；預設值 franchise 不寫入）。 */
export function enumRule(name: string, kept: readonly string[]): QueryRule {
  return { name, normalize: (raw) => (kept.includes(raw) ? raw : null) };
}

function firstValue(v: string | readonly string[] | undefined): string | undefined {
  return typeof v === "string" ? v : v?.[0];
}

/** 依規則順序輸出正規 query（不含 `?`）。其餘參數全部丟棄。 */
export function canonicalQuery(sp: RawSearchParams, rules: readonly QueryRule[]): string {
  const parts: string[] = [];
  for (const rule of rules) {
    const raw = firstValue(sp[rule.name]);
    if (raw === undefined) continue;
    const v = rule.normalize(raw);
    if (v !== null) parts.push(`${encodeURIComponent(rule.name)}=${encodeURIComponent(v)}`);
  }
  return parts.join("&");
}
