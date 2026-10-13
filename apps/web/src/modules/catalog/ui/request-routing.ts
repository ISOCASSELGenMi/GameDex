/**
 * 帶語系前綴的 catalog 路由，在 proxy 先做的便宜判斷（純函式，不碰 DB）。
 *
 * 為什麼在 proxy：cacheComponents 開啟時，頁面回應一律以 PPR 方式恢復渲染（即使外殼是空的），
 * 狀態碼在頁面程式執行前就以 200 送出，頁面內的 notFound()／redirect() 只會變成「軟 404」與客戶端導向
 * （Next 16.4 實測，見 C-report）。所以能不查 DB 就判斷的 404 與導向放在 proxy，回真正的狀態碼。
 */
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
  return `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | ${site}</title><style>:root{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans TC","Microsoft JhengHei",sans-serif;background:#fff;color:#111827}main{max-width:40rem;margin:0 auto;padding:3rem 1rem}a{color:#1d4ed8}@media (prefers-color-scheme:dark){body{background:#0b0f14;color:#e5e7eb}a{color:#93c5fd}}</style></head><body><main id="main"><p><a href="${href}">${site}</a></p><h1>${title}</h1><p>${escapeHtml(t.t("errors.notFound.description"))}</p><p><a href="${href}">${escapeHtml(t.t("errors.backToCalendar"))}</a></p></main></body></html>`;
}
