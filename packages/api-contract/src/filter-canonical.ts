/**
 * 篩選 query string 的正規形式（快取鍵穩定，spec 06 §SEO 與快取、15 Phase 3.5）。
 *
 * 3a 的篩選表單（GET）送出 `?platform=a&platform=b&genre=`，與正規形式 `?platform=a,b` 不同；
 * 同一組條件會有很多種網址，CDN 快取鍵不穩。proxy 用這裡的函式判斷並 308 到正規網址。
 *
 * 正規形式：
 * 1. 篩選參數依 FILTER_PARAMS 順序、值排序去重、空參數省略（= `filterSpecToQueryString`）。
 * 2. 其他參數（`cursor`、`date`、`page`…，不屬於 FilterSpec）保留原值，依參數名稱排序（同名保持原順序），
 *    接在篩選參數之後，以 encodeURIComponent 編碼。
 *
 * **有 issue（格式錯、未知 enum、超量、重複單值）時不轉址**：讓頁面照常解析並「忽略並提示」，
 * 否則 308 後提示就消失了。查無此 slug（要查 DB 才知道）也不在這裡處理。
 */
import { filterSpecToQueryString, isFilterParam, parseFilterSpec } from "./filter-spec";

export interface CanonicalFilterQuery {
  /** 正規 query string（不含 `?`）；沒有任何參數時為空字串。 */
  query: string;
  /** 輸入已經是正規形式（逐字相同）。 */
  isCanonical: boolean;
  /** parseFilterSpec 回報了 issue（此時不應轉址）。 */
  hasIssues: boolean;
}

function toSearch(input: string | URLSearchParams): { raw: string; params: URLSearchParams } {
  if (typeof input === "string") {
    const raw = input.startsWith("?") ? input.slice(1) : input;
    return { raw, params: new URLSearchParams(raw) };
  }
  return { raw: input.toString(), params: input };
}

/**
 * 計算正規形式。`input` 是 `URL#search`（可帶 `?`）或 URLSearchParams。
 * 傳 URLSearchParams 時 `isCanonical` 以 `params.toString()` 比較（會把逗號編成 `%2C`，幾乎一定不相等），
 * 所以 proxy 請傳 `request.nextUrl.search` 字串。
 */
export function canonicalizeFilterQuery(input: string | URLSearchParams): CanonicalFilterQuery {
  const { raw, params } = toSearch(input);
  const { filter, issues } = parseFilterSpec(params);
  const parts: string[] = [];
  const filterPart = filterSpecToQueryString(filter);
  if (filterPart) parts.push(filterPart);

  const others: Array<[string, string]> = [];
  for (const [k, v] of params) if (!isFilterParam(k)) others.push([k, v]);
  others.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // Array#sort 是穩定排序：同名保持原順序
  for (const [k, v] of others) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);

  const query = parts.join("&");
  return { query, isCanonical: query === raw, hasIssues: issues.length > 0 };
}

/**
 * proxy 用：需要 308 時回傳正規 search（含 `?`，沒有參數時為空字串），否則 null。
 *
 * ```ts
 * const target = filterRedirectSearch(request.nextUrl.search);
 * if (target !== null) {
 *   const url = request.nextUrl.clone();
 *   url.search = target;
 *   return NextResponse.redirect(url, 308);
 * }
 * ```
 * 只套用在讀 FilterSpec 的頁面（月曆、時間軸、瀏覽）；`/api/*` 不轉址。
 */
export function filterRedirectSearch(search: string): string | null {
  const c = canonicalizeFilterQuery(search);
  if (c.isCanonical || c.hasIssues) return null;
  return c.query ? `?${c.query}` : "";
}
