/**
 * JSON-LD（schema.org）：純函式。輸出給 `<script type="application/ld+json">`。
 *
 * 安全：JSON 字串放進 <script> 時，內容裡的 `</script>`、`<!--` 會提前結束／改變解析，名稱等欄位又來自外部資料
 * （IGDB），所以 `serializeJsonLd` 把 `<`、`>`、`&`、U+2028／U+2029 都改成 \uXXXX（JSON 解析後值不變）。
 * 這是唯一輸出 JSON-LD 的地方（元件與測試都經它）。
 */
import type { Locale } from "@sok/i18n";
import type { DatePrecision, EventDetail, GameDetail, IsoDate } from "../../domain/entities";
import { DEFAULT_RATING_DISPLAY_CONFIG, type RatingDisplayConfig } from "../../domain/rating-config";
import { defaultSelectedProviders, selectRatings } from "../../domain/rating-display";
import { safeExternalUrl } from "../external-url";
import { absoluteUrl } from "./site-url";

export type JsonLd = Record<string, unknown>;

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

export interface JsonLdContext {
  /** 站台 origin；null → 相對網址。 */
  origin: string | null;
  locale: Locale;
  /** 評分顯示設定（站長層）；省略＝不過濾、預設優先序。 */
  ratingConfig?: RatingDisplayConfig;
}

const url = (ctx: JsonLdContext, path: string) => absoluteUrl(ctx.origin, path);

/**
 * schema.org datePublished 允許的部分日期：day＝YYYY-MM-DD、month＝YYYY-MM、year＝YYYY；
 * quarter／tbd／無日期 → 省略（沒有對應的 ISO 8601 寫法，也不猜）。
 */
export function datePublished(date: IsoDate | null, precision: DatePrecision | null): string | undefined {
  if (!date) return undefined;
  if (precision === "day") return date;
  if (precision === "month") return date.slice(0, 7);
  if (precision === "year") return date.slice(0, 4);
  return undefined;
}

function organization(name: string, pageUrl: string): JsonLd {
  return { "@type": "Organization", name, url: pageUrl };
}

function aggregateRating(game: GameDetail, config: RatingDisplayConfig): JsonLd | null {
  const { primary } = selectRatings(game.ratings, {
    visible: config.visible,
    hiddenScoreTypes: config.hiddenScoreTypes,
    selected: defaultSelectedProviders(config.visible),
    priority: config.priority,
  });
  if (!primary || primary.reviewCount == null || primary.reviewCount <= 0) return null;
  return {
    "@type": "AggregateRating",
    ratingValue: primary.score,
    bestRating: primary.scoreMax,
    worstRating: 0,
    ratingCount: primary.reviewCount,
  };
}

/**
 * 遊戲詳情 → VideoGame。aggregateRating 只用預設來源（IGDB）經 selectRatings 選出的主分數（05：JSON-LD 只用預設來源），
 * 且評論數 > 0 才輸出（schema.org 需要 ratingCount）；沒有分數 → 省略。
 * description 是 IGDB 原文（英文），不標 inLanguage（同一份資料裡其餘欄位是頁面語系）。
 */
export function gameJsonLd(game: GameDetail, ctx: JsonLdContext): JsonLd {
  const pagePath = `/${ctx.locale}/games/${encodeURIComponent(game.slug)}`;
  const developers = game.companies.filter((c) => c.roles.includes("developer"));
  const publishers = game.companies.filter((c) => c.roles.includes("publisher"));
  const companyUrl = (slug: string) => url(ctx, `/${ctx.locale}/companies/${encodeURIComponent(slug)}`);
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    "@id": `${url(ctx, pagePath)}#game`,
    name: game.name,
    url: url(ctx, pagePath),
  };
  if (game.originalName !== game.name) ld.alternateName = game.originalName;
  if (game.cover?.large) ld.image = game.cover.large;
  if (game.summary) ld.description = game.summary;
  if (game.platforms.length > 0) ld.gamePlatform = game.platforms.map((p) => p.name);
  const published = datePublished(game.firstReleaseDate, game.firstReleasePrecision);
  if (published) ld.datePublished = published;
  if (game.genres.length > 0) ld.genre = game.genres.map((g) => g.name);
  if (developers.length > 0) ld.author = developers.map((c) => organization(c.name, companyUrl(c.slug)));
  if (publishers.length > 0) ld.publisher = publishers.map((c) => organization(c.name, companyUrl(c.slug)));
  const aggregate = aggregateRating(game, ctx.ratingConfig ?? DEFAULT_RATING_DISPLAY_CONFIG);
  if (aggregate) ld.aggregateRating = aggregate;
  const trailer = safeExternalUrl(game.trailerUrl);
  if (trailer) ld.trailer = { "@type": "VideoObject", name: game.name, contentUrl: trailer };
  return ld;
}

/**
 * 活動詳情 → Event。時間未定（startTime 為 null）→ 回 null（startDate 是必填，不猜）。
 * 時間一律 UTC ISO（資料庫存的就是 UTC）。eventStatus：IGDB 沒有取消／延期資訊，一律 EventScheduled；
 * 有直播連結才標 OnlineEventAttendanceMode＋VirtualLocation，其餘省略（不確定是線上還是現場）。
 */
export function eventJsonLd(ev: EventDetail, ctx: JsonLdContext): JsonLd | null {
  if (!ev.startTime) return null;
  const pagePath = `/${ctx.locale}/events/${encodeURIComponent(ev.slug)}`;
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${url(ctx, pagePath)}#event`,
    name: ev.name,
    url: url(ctx, pagePath),
    startDate: new Date(ev.startTime).toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
  };
  if (ev.endTime) ld.endDate = new Date(ev.endTime).toISOString();
  if (ev.description) ld.description = ev.description;
  if (ev.logo?.large) ld.image = ev.logo.large;
  if (ev.organizer) ld.organizer = { "@type": "Organization", name: ev.organizer };
  const stream = safeExternalUrl(ev.streamUrl);
  if (stream) {
    ld.eventAttendanceMode = "https://schema.org/OnlineEventAttendanceMode";
    ld.location = { "@type": "VirtualLocation", url: stream };
  }
  return ld;
}

export interface Crumb {
  name: string;
  /** 去掉語系前綴的路徑；最後一個（目前頁）可省略。 */
  path?: string;
}

/** 麵包屑 BreadcrumbList。path 省略的項目不帶 item（目前頁）。 */
export function breadcrumbJsonLd(crumbs: readonly Crumb[], ctx: JsonLdContext): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path !== undefined ? { item: url(ctx, `/${ctx.locale}${c.path === "/" ? "" : c.path}`) } : {}),
    })),
  };
}

/** 首頁 -> WebSite + SearchAction（搜尋是 `/games?q=`，與遊戲瀏覽頁同一個查詢參數）。 */
export function websiteJsonLd(name: string, ctx: JsonLdContext): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url: url(ctx, `/${ctx.locale}`),
    inLanguage: ctx.locale,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${url(ctx, `/${ctx.locale}/games`)}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
