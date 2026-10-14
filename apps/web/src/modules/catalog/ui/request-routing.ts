/**
 * 帶語系前綴的 catalog 路由，在 proxy 先做的便宜判斷（純函式，不碰 DB）。
 *
 * 為什麼在 proxy：cacheComponents 開啟時，頁面回應一律以 PPR 方式恢復渲染（即使外殼是空的），
 * 狀態碼在頁面程式執行前就以 200 送出，頁面內的 notFound()／redirect() 只會變成「軟 404」與客戶端導向
 * （Next 16.4 實測，見 C-report）。所以能不查 DB 就判斷的 404 與導向放在 proxy，回真正的狀態碼。
 */
import { filterRedirectSearch } from "@sok/api-contract";
import { createTranslator, type Locale } from "@sok/i18n";
import { calendarMonthPath, localeHref } from "./links";
import { monthOfDate, parseMonthParam } from "./month";

export type LocalizedRouteDecision =
  | { type: "next" }
  | { type: "redirect"; location: string }
  | { type: "notFound"; locale: Locale };

/**
 * pathname 的第一段必須已確認是支援語系。
 * - `/{locale}`、`/{locale}/calendar` → 導到今天（UTC）所在月份（保留 query）
 * - `/{locale}/calendar/{不合法月份}`、`/{locale}/calendar/{月份}/{多餘}` → 404
 */
export function decideLocalizedRoute(pathname: string, locale: Locale, search: string, now: Date): LocalizedRouteDecision {
  const segs = pathname.split("/").filter((s, i) => i === 0 || s !== "");
  // segs[0] === ""、segs[1] === locale
  const rest = segs.slice(2);
  if (rest.length === 0 || (rest.length === 1 && rest[0] === "calendar")) {
    return { type: "redirect", location: localeHref(locale, calendarMonthPath(monthOfDate(now)), search) };
  }
  if (rest[0] === "calendar") {
    if (rest.length > 2 || !parseMonthParam(rest[1] ?? "")) return { type: "notFound", locale };
  }
  return { type: "next" };
}

/**
 * 讀 FilterSpec 的頁面（去掉語系前綴後的路徑段）：月曆 `/calendar/{yyyy-mm}`、時間軸、熱門榜、瀏覽列表 `/games`。
 * 不含 `/games/{slug}`（詳情頁）與 `/api/*`（proxy 的 matcher 已排除）。新增吃篩選參數的頁面時在這裡加一行。
 */
export function isFilterCanonicalPath(rest: readonly string[]): boolean {
  if (rest.length === 2) return rest[0] === "calendar";
  if (rest.length === 1) return rest[0] === "timeline" || rest[0] === "trending" || rest[0] === "games";
  return false;
}

/**
 * 篩選 query 的正規化（06 §SEO 與快取）：同一組條件只有一種網址，CDN 快取鍵才穩定。
 * 需要時回傳 308 的目標（含語系前綴的路徑＋正規 search）；已是正規形式、有格式問題（交給頁面「忽略並提示」）、
 * 不是篩選頁面時回 null。冪等。
 */
export function decideFilterRedirect(pathname: string, search: string): string | null {
  const rest = pathname.split("/").filter((s, i) => i === 0 || s !== "").slice(2);
  if (!isFilterCanonicalPath(rest)) return null;
  const target = filterRedirectSearch(search);
  // 「只差百分比編碼」不轉址的比較在 api-contract 的 filterRedirectSearch（唯一實作）
  if (target === null) return null;
  return `${pathname}${target}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * proxy 直接回的 404 文件（不經 React 渲染：PPR 恢復渲染的 404 外殼在沒有 JS 時是空白頁）。
 * 文字來自字典；樣式只用最少的 inline CSS（含深色模式）。
 */
export function renderNotFoundHtml(locale: Locale): string {
  const t = createTranslator(locale, ["ui", "errors"]);
  const title = escapeHtml(t.t("errors.notFound.title"));
  const site = escapeHtml(t.t("ui.site.name"));
  const href = escapeHtml(localeHref(locale, "/calendar"));
  return `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | ${site}</title><style>:root{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans TC","Microsoft JhengHei",sans-serif}body:lang(ja){font-family:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans JP",sans-serif}body{background:#fff;color:#111827}main{max-width:40rem;margin:0 auto;padding:3rem 1rem}a{color:#1d4ed8}@media (prefers-color-scheme:dark){body{background:#0b0f14;color:#e5e7eb}a{color:#93c5fd}}</style></head><body><main id="main"><p><a href="${href}">${site}</a></p><h1>${title}</h1><p>${escapeHtml(t.t("errors.notFound.description"))}</p><p><a href="${href}">${escapeHtml(t.t("errors.backToCalendar"))}</a></p></main></body></html>`;
}
