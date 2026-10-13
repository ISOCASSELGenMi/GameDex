// @module kernel
// 請求進入頁面前的判斷（06 §多語系）：
// 1. 無語系前綴的入口（`/`、`/calendar`…）→ 依 Cookie → Accept-Language → 預設語系 302 導向（private、Vary）
// 2. 帶前綴的網址一律不依偏好導向；語系不支援 → 404
// 3. catalog 路由不需查 DB 的導向／404（月份格式等）在這裡做，才能回真正的狀態碼（見 modules/catalog/ui/request-routing.ts；proxy 只經 ui/routing.ts 這個輕量入口取得）
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, getLocaleConfig, isSupportedLocale, needsLocalePrefix, pickRequestLocale } from "@/kernel/locale";
import type { Locale } from "@sok/i18n";
import { decideLocalizedRoute, renderNotFoundHtml } from "@/modules/catalog/ui/routing";

function notFoundResponse(locale: Locale): NextResponse {
  return new NextResponse(renderNotFoundHtml(locale), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

function applyLocation(target: URL, location: string): void {
  const q = location.indexOf("?");
  target.pathname = q < 0 ? location : location.slice(0, q);
  target.search = q < 0 ? "" : location.slice(q);
}

export function proxy(request: NextRequest): NextResponse | undefined {
  const { pathname, search } = request.nextUrl;
  const config = getLocaleConfig();

  if (needsLocalePrefix(pathname, config)) {
    const locale = pickRequestLocale(
      { cookie: request.cookies.get(LOCALE_COOKIE)?.value, acceptLanguage: request.headers.get("accept-language") },
      config,
    );
    const target = request.nextUrl.clone();
    target.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
    target.search = search;
    // `/`、`/calendar` 直接導到當月，少一次轉址
    const next = decideLocalizedRoute(target.pathname, locale, search, new Date());
    if (next.type === "redirect") applyLocation(target, next.location);
    const res = NextResponse.redirect(target, 302);
    // 依 Cookie／Accept-Language 決定，共用快取不可存（06 §SEO 與快取）
    res.headers.set("Cache-Control", "private, no-cache");
    res.headers.set("Vary", "Accept-Language, Cookie");
    return res;
  }

  const first = pathname.split("/")[1] ?? "";
  if (!isSupportedLocale(first, config)) return notFoundResponse(config.defaultLocale);

  const decision = decideLocalizedRoute(pathname, first, search, new Date());
  if (decision.type === "redirect") {
    const target = request.nextUrl.clone();
    applyLocation(target, decision.location);
    const res = NextResponse.redirect(target, 307);
    // 只依日期（不依使用者）變動：可短暫共用快取
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }
  if (decision.type === "notFound") return notFoundResponse(decision.locale);
  return undefined;
}

export const config = {
  // 排除：/healthz、/readyz、/api、Next 內部（_next）、有副檔名的靜態檔（favicon.ico、robots.txt…）
  matcher: ["/((?!api/|api$|healthz|readyz|_next/|.*\\.[A-Za-z0-9]+$).*)"],
};
