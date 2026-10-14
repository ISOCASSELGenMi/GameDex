/**
 * 頁面 metadata 的 SEO 部分（canonical、hreflang、robots、Open Graph）。薄路由的 generateMetadata 呼叫這裡，
 * 不自己拼網址。語系清單與預設語系由路由傳入（getLocaleConfig()），這裡不讀環境。
 */
import type { Metadata } from "next";
import type { Locale } from "@sok/i18n";
import type { EventDetail, GameDetail } from "../../domain/entities";
import { buildAlternates, canonicalQuery, localizedUrl, type QueryRule, type RawSearchParams } from "./alternates";
import { shouldNoindexFilter } from "./robots-policy";
import { safeDecode } from "../entities/view-model";
import { siteOrigin } from "./site-url";

export interface SeoLocaleConfig {
  supported: readonly Locale[];
  defaultLocale: Locale;
}

export interface SeoMetadataInput {
  locale: Locale;
  config: SeoLocaleConfig;
  /** 去掉語系前綴的路徑（`/games/zelda`、`/calendar/2026-10`、`/`）。 */
  path: string;
  /** 目前請求的 searchParams；有 `queryRules` 才會用到。 */
  searchParams?: RawSearchParams;
  /** 哪些參數屬於「正規網址」（其餘全部去掉）。沒給＝正規網址不帶 query。 */
  queryRules?: readonly QueryRule[];
  /** true＝套用 FilterSpec 的 noindex 規則（多維組合、搜尋）。 */
  filterPage?: boolean;
  /** 測試用；預設讀 NEXT_PUBLIC_SITE_URL。 */
  origin?: string | null;
}

/** canonical＋alternates（含 x-default）＋必要時 noindex。title 等由路由自己加。 */
export function seoMetadata(input: SeoMetadataInput): Metadata {
  const origin = input.origin === undefined ? siteOrigin() : input.origin;
  const query = input.searchParams && input.queryRules ? canonicalQuery(input.searchParams, input.queryRules) : "";
  const alternates = buildAlternates({
    origin,
    locale: input.locale,
    supported: input.config.supported,
    defaultLocale: input.config.defaultLocale,
    path: input.path,
    query,
  });
  const meta: Metadata = { alternates: { canonical: alternates.canonical, languages: alternates.languages } };
  if (input.filterPage && input.searchParams && shouldNoindexFilter(input.searchParams)) {
    meta.robots = { index: false, follow: true };
  }
  return meta;
}

/** 路由參數裡的 slug（可能已編碼也可能沒有）→ 路徑片段：先解碼再編碼一次，同一個 slug 只有一種寫法。 */
export function seoSlug(slug: string): string {
  return encodeURIComponent(safeDecode(slug));
}

const DESCRIPTION_MAX = 160;

/** meta description：取前 160 字（以 code point 計，不切斷代理對），超過加「…」。 */
export function truncateDescription(text: string | null | undefined): string | undefined {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  const chars = [...flat];
  return chars.length <= DESCRIPTION_MAX ? flat : `${chars.slice(0, DESCRIPTION_MAX - 1).join("")}…`;
}

type DetailInput = Pick<SeoMetadataInput, "locale" | "config" | "origin">;

function detailMetadata(
  input: DetailInput,
  path: string,
  title: string,
  summary: string | null,
  image: string | undefined,
): Metadata {
  const origin = input.origin === undefined ? siteOrigin() : input.origin;
  const base = seoMetadata({ ...input, origin, path });
  const description = truncateDescription(summary);
  return {
    ...base,
    title,
    ...(description ? { description } : {}),
    openGraph: {
      type: "website",
      title,
      url: localizedUrl(origin, input.locale, path),
      ...(description ? { description } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

/** 遊戲詳情：canonical＋alternates＋description＋Open Graph。 */
export function gameDetailMetadata(game: GameDetail, input: DetailInput): Metadata {
  return detailMetadata(input, `/games/${encodeURIComponent(game.slug)}`, game.name, game.summary, game.cover?.large);
}

/** 活動詳情：canonical＋alternates＋description＋Open Graph。 */
export function eventDetailMetadata(ev: EventDetail, input: DetailInput): Metadata {
  return detailMetadata(input, `/events/${encodeURIComponent(ev.slug)}`, ev.name, ev.description, ev.logo?.large);
}
