/**
 * ics 內的絕對連結（公開 feed 與 accounts 的私人 feed 共用；不依賴 next/server，所以可以從 catalog/index.ts 匯出）。
 */
import type { IcalLinkBuilder } from "../use-cases/ical";
import { siteOrigin } from "../ui/seo/site-url";
import { gameHref, localeHref } from "../ui/links";

export const ICAL_CONTENT_TYPE = "text/calendar; charset=utf-8";

/** 請求的 origin（有反向代理時看 X-Forwarded-*）；NEXT_PUBLIC_SITE_URL 沒設時才用。 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** ics 內的絕對連結：NEXT_PUBLIC_SITE_URL 優先，沒設就用請求的 origin。 */
export function icalLinks(locale: Parameters<typeof localeHref>[0], request: Request): IcalLinkBuilder {
  const origin = siteOrigin() ?? requestOrigin(request);
  return {
    game: (slug) => `${origin}${gameHref(locale, slug)}`,
    event: (slug) => `${origin}${localeHref(locale, `/events/${encodeURIComponent(slug)}`)}`,
  };
}
