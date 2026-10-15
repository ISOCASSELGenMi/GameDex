/**
 * 公開 iCal feed 的 HTTP 處理（08 §公開 feed、§HTTP 快取）。app/ical/** 只是薄路由。
 *
 *   GET /ical/{locale}/releases.ics            未來 90 天的上市（依熱度取前 ICAL_PUBLIC_MAX_EVENTS 筆）
 *   GET /ical/{locale}/events.ics              活動
 *   GET /ical/{locale}/platform/{slug}.ics     單一平台
 *   GET /ical/{locale}/game/{slug}.ics         單一遊戲「下載 .ics」（Content-Disposition: attachment）
 *
 * 回應：`Content-Type: text/calendar; charset=utf-8`、`Cache-Control: public, max-age=300`、`ETag`（If-None-Match 相符 → 304）、
 * 不送 Set-Cookie。語系不支援、平台／遊戲不存在、檔名不是 `.ics` → 404。查詢逾時 → 503＋Retry-After。
 * `/ical/*` 的副檔名讓 proxy.ts 的 matcher 直接略過（不做語系導向）。
 */
import { connection } from "next/server";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { isCatalogQueryTimeoutError } from "../domain/entities/read-errors";
import { siteOrigin } from "../ui/seo/site-url";
import { gameHref, localeHref } from "../ui/links";
import { ifNoneMatchHits, prepareIcalFeed, type IcalFeedSpec, type IcalLinkBuilder } from "../use-cases/ical";

export const ICAL_CONTENT_TYPE = "text/calendar; charset=utf-8";
export const ICAL_CACHE_CONTROL = "public, max-age=300";

const NOT_FOUND_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } as const;

function notFound(): Response {
  return new Response("not found", { status: 404, headers: NOT_FOUND_HEADERS });
}

function failure(err: unknown): Response {
  if (isCatalogQueryTimeoutError(err)) {
    return new Response("temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
  throw err;
}

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

/** `ps5.ics` → `ps5`；不是 `.ics` 結尾或沒有檔名 → null。 */
export function slugFromIcsFile(file: string): string | null {
  if (!file.toLowerCase().endsWith(".ics")) return null;
  const slug = file.slice(0, -4).trim().toLowerCase();
  return slug && slug.length <= 255 ? slug : null;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function icalFeedResponse(request: Request, localeParam: string, spec: IcalFeedSpec): Promise<Response> {
  const config = getLocaleConfig();
  if (!isSupportedLocale(localeParam, config)) return notFound();
  const locale = localeParam;
  await connection();
  try {
    const feed = await prepareIcalFeed({ spec, locale, links: icalLinks(locale, request) });
    if (!feed) return notFound();
    const headers: Record<string, string> = {
      "Content-Type": ICAL_CONTENT_TYPE,
      "Cache-Control": ICAL_CACHE_CONTROL,
      ETag: feed.etag,
    };
    if (spec.kind === "game") headers["Content-Disposition"] = `attachment; filename="${safeFileName(feed.fileName)}"`;
    if (ifNoneMatchHits(request.headers.get("if-none-match"), feed.etag)) {
      // 304 不帶本體與 Content-Type／Content-Disposition，其餘快取相關標頭照送
      return new Response(null, { status: 304, headers: { "Cache-Control": ICAL_CACHE_CONTROL, ETag: feed.etag } });
    }
    return new Response(await feed.render(), { status: 200, headers });
  } catch (err) {
    return failure(err);
  }
}

export function releasesFeed(request: Request, locale: string): Promise<Response> {
  return icalFeedResponse(request, locale, { kind: "releases" });
}

export function eventsFeed(request: Request, locale: string): Promise<Response> {
  return icalFeedResponse(request, locale, { kind: "events" });
}

export async function platformFeed(request: Request, locale: string, file: string): Promise<Response> {
  const slug = slugFromIcsFile(file);
  return slug ? icalFeedResponse(request, locale, { kind: "platform", slug }) : notFound();
}

export async function gameFeed(request: Request, locale: string, file: string): Promise<Response> {
  const slug = slugFromIcsFile(file);
  return slug ? icalFeedResponse(request, locale, { kind: "game", slug }) : notFound();
}
