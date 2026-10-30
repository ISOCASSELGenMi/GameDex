/**
 * 即時篩選的網址運算（純函式，瀏覽器與單元測試共用；06 §篩選 UI「即時套用」）。
 *
 * 網址是唯一狀態。使用者改變任一篩選欄位時，新網址＝「目前網址」
 *   − 表單裡有名稱的欄位（controlled）
 *   + 表單目前的值（entries）
 * 其他所有參數（時間軸的 `week`／`at`、瀏覽頁的 `page`／`by`／`gfrom`／`gsort`／`gdir`、評分排名頁的累計頁數、`show`…）
 * 原樣留在網址上，所以篩選不會把使用者丟回預設日期或第 1 頁。
 * 伺服器渲染的 hidden 欄位只服務沒有 JS 的表單送出；時間軸切週是 pushState（伺服器不知道），hidden 的 `week` 會過期，所以有 JS 時一律讀目前網址。
 * 結果一律經 canonicalizeFilterQuery 整理成正規形式（與 proxy 的 308 一致，不會多一次轉址）。
 */
import { canonicalizeFilterQuery, isFilterParam } from "@sok/api-contract";

/** 表單以外的篩選連結（chip、平台種類快速篩選）導覽前發出：表單欄位要在新內容換進來後重新掛載，才會與網址一致。 */
export const EXTERNAL_FILTER_EVENT = "sok:filters-external";

export type LiveEntry = readonly [name: string, value: string];

function stripQuestion(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

function withQuery(action: string, params: URLSearchParams): string {
  // 有 issue（例如評分排名頁的 sort=players 不是篩選的排序值）時 canonicalize 會丟掉那個值：與 proxy 一致，不整理、原樣送出
  const c = canonicalizeFilterQuery(params.toString());
  const query = c.hasIssues ? params.toString() : c.query;
  return query ? `${action}?${query}` : action;
}

/** 依表單目前的狀態算出新網址：目前網址 − controlled ＋ entries（空值略過）。 */
export function liveFilterHref(input: {
  /** 表單的路徑（不含 query；月曆含年月）。 */
  action: string;
  /** window.location.search。 */
  currentSearch: string;
  /** 表單內所有有名稱的欄位（包含這次沒有值的，例如全部取消勾選的核取方塊群組）。 */
  controlled: Iterable<string>;
  entries: Iterable<LiveEntry>;
}): string {
  const drop = new Set(input.controlled);
  const params = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(stripQuestion(input.currentSearch))) if (!drop.has(k)) params.append(k, v);
  for (const [k, v] of input.entries) if (v !== "") params.append(k, v);
  return withQuery(input.action, params);
}

/** 「全部清除」：移除所有篩選參數與表單欄位，其餘（位置）參數保留。 */
export function clearFilterHref(input: { action: string; currentSearch: string; controlled?: Iterable<string> }): string {
  const drop = new Set(input.controlled ?? []);
  const params = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(stripQuestion(input.currentSearch))) if (!isFilterParam(k) && !drop.has(k)) params.append(k, v);
  return withQuery(input.action, params);
}

/**
 * 伺服器算好的篩選連結（chip 移除、平台種類快速篩選）：篩選參數取連結的，其餘（位置）參數改取目前網址。
 * 伺服器渲染當下的位置可能已經過期（時間軸切週不重新渲染伺服器元件）。
 */
export function keepPositionHref(href: string, currentSearch: string): string {
  const target = new URL(href, "http://local.invalid");
  const params = new URLSearchParams();
  for (const [k, v] of target.searchParams) if (isFilterParam(k)) params.append(k, v);
  for (const [k, v] of new URLSearchParams(stripQuestion(currentSearch))) if (!isFilterParam(k)) params.append(k, v);
  return withQuery(target.pathname, params);
}

/** 兩個網址（路徑＋query）在語意上相同：逐一解碼後的 (名稱, 值) 序列相同。 */
export function sameLocation(a: string, b: string): boolean {
  const x = new URL(a, "http://local.invalid");
  const y = new URL(b, "http://local.invalid");
  if (x.pathname !== y.pathname) return false;
  const p = [...x.searchParams];
  const q = [...y.searchParams];
  return p.length === q.length && p.every(([k, v], i) => k === q[i]![0] && v === q[i]![1]);
}

/**
 * 篩選後頁碼超出範圍時退到最後一頁：在 [1, max] 找最大的「有內容」的頁碼（有內容的頁碼是連續的前段）。
 * `hasContent(page)` 查那一頁是不是空的；只在要求的頁碼為空時才呼叫（約 log2(max) 次查詢）。
 */
export async function lastPageWithContent(max: number, hasContent: (page: number) => Promise<boolean>): Promise<number> {
  let lo = 1;
  let hi = Math.max(1, Math.floor(max));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await hasContent(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
