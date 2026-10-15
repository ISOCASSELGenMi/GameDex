/**
 * sitemap 的純函式（分片規劃、網址展開、XML 輸出）。無 DB、無 React。
 *
 * 規格（06 §SEO 與快取）：單檔 ≤ 50,000 URL／50 MB；sitemap index＋分片；每個網址以 `xhtml:link` 列各語系替代網址。
 * Google 的 hreflang 規則：每個語系版本自己也要有一個 `<url>`，並在其中列出所有版本（含自己）。
 * 所以「一個實體 × N 個語系」＝ N 個 `<url>`；分片大小以「實體數」計，保證每片的 URL 數 ≤ 50,000。
 * 篩選後的網址（帶 query 的篩選頁）不列入。
 */
import type { Locale } from "@sok/i18n";
import type { SitemapCounts, SitemapEntry, SitemapShardedKind } from "../../domain/entities";
import { SITEMAP_SHARDED_KINDS } from "../../domain/entities";
import { hreflangOf, localizedUrl } from "./alternates";
import { addMonths, formatMonthParam, type YearMonth } from "../month";

/** 單一 sitemap 檔的 URL 上限（sitemaps.org）。 */
export const SITEMAP_MAX_URLS = 50_000;
/** 每片實體數的上限（再大單次產生的記憶體與時間都不划算；實際值還要受語系數限制）。 */
export const SITEMAP_MAX_ENTITIES_PER_SHARD = 10_000;

/** 每片最多幾個實體，使「實體 × 語系數」不超過 50,000。 */
export function entitiesPerShard(localeCount: number): number {
  const n = Math.max(1, Math.floor(localeCount));
  return Math.max(1, Math.min(SITEMAP_MAX_ENTITIES_PER_SHARD, Math.floor(SITEMAP_MAX_URLS / n)));
}

export function shardCount(entityCount: number, perShard: number): number {
  return entityCount <= 0 ? 0 : Math.ceil(entityCount / perShard);
}

// ── 分片名稱 ─────────────────────────────────────────────────────────────

/** `pages.xml`（固定頁、月曆、平台、活動）或 `games-0.xml`、`companies-3.xml`、`franchises-0.xml`。 */
export type SitemapShardName = "pages.xml" | `${SitemapShardedKind}-${number}.xml`;

export type ParsedShard = { type: "pages" } | { type: "entities"; kind: SitemapShardedKind; shard: number };

const SHARD_NAME = /^(games|companies|franchises)-(0|[1-9]\d{0,5})\.xml$/;

export function parseShardName(name: string): ParsedShard | null {
  if (name === "pages.xml") return { type: "pages" };
  const m = SHARD_NAME.exec(name);
  if (!m) return null;
  return { type: "entities", kind: m[1] as SitemapShardedKind, shard: Number(m[2]) };
}

/** index 要列出的所有分片名稱（依序）。 */
export function planShards(counts: SitemapCounts, localeCount: number): SitemapShardName[] {
  const per = entitiesPerShard(localeCount);
  const names: SitemapShardName[] = ["pages.xml"];
  for (const kind of SITEMAP_SHARDED_KINDS) {
    for (let i = 0; i < shardCount(counts[kind], per); i += 1) names.push(`${kind}-${i}.xml`);
  }
  return names;
}

// ── 網址 ─────────────────────────────────────────────────────────────────

export interface SitemapUrlSpec {
  /** 去掉語系前綴的路徑。 */
  path: string;
  /** 正規 query（不含 `?`），例如系列頁 `kind=collection`。 */
  query?: string;
  /** ISO 8601 時間。 */
  lastModified?: string | null;
}

export interface SitemapLocaleContext {
  origin: string;
  supported: readonly Locale[];
  defaultLocale: Locale;
}

const enc = encodeURIComponent;

export const gameSitemapSpec = (e: SitemapEntry): SitemapUrlSpec => ({ path: `/games/${enc(e.slug)}`, lastModified: e.lastModified });
export const companySitemapSpec = (e: SitemapEntry): SitemapUrlSpec => ({ path: `/companies/${enc(e.slug)}`, lastModified: e.lastModified });
export const platformSitemapSpec = (e: SitemapEntry): SitemapUrlSpec => ({ path: `/platforms/${enc(e.slug)}`, lastModified: e.lastModified });
export const eventSitemapSpec = (e: SitemapEntry): SitemapUrlSpec => ({ path: `/events/${enc(e.slug)}`, lastModified: e.lastModified });
export const franchiseSitemapSpec = (e: SitemapEntry): SitemapUrlSpec => ({
  path: `/franchises/${enc(e.slug)}`,
  query: e.kind === "collection" ? "kind=collection" : undefined,
  lastModified: e.lastModified,
});

export function specsForKind(kind: SitemapShardedKind, entries: readonly SitemapEntry[]): SitemapUrlSpec[] {
  const f = kind === "games" ? gameSitemapSpec : kind === "companies" ? companySitemapSpec : franchiseSitemapSpec;
  return entries.map(f);
}

/** 月曆月份範圍：今天（UTC）所在月份往前 `past` 個月、往後 `future` 個月（含）。 */
export function calendarMonthRange(now: Date, past = 12, future = 24): YearMonth[] {
  const cur: YearMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const out: YearMonth[] = [];
  for (let d = -past; d <= future; d += 1) {
    const ym = addMonths(cur, d);
    if (ym) out.push(ym);
  }
  return out;
}

/** `pages.xml` 的內容：固定頁、月曆各月、平台、活動。 */
export function pageSpecs(input: {
  now: Date;
  platforms: readonly SitemapEntry[];
  events: readonly SitemapEntry[];
}): SitemapUrlSpec[] {
  return [
    ...calendarMonthRange(input.now).map((ym): SitemapUrlSpec => ({ path: `/calendar/${formatMonthParam(ym)}` })),
    { path: "/timeline" },
    { path: "/trending" },
    { path: "/games" },
    { path: "/platforms" },
    { path: "/events" },
    { path: "/subscribe" },
    { path: "/about/data-sources" },
    { path: "/about/privacy" },
    { path: "/about/terms" },
    { path: "/about/contact" },
    ...input.platforms.map(platformSitemapSpec),
    ...input.events.map(eventSitemapSpec),
  ];
}

// ── XML ──────────────────────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

function lastmod(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : `<lastmod>${new Date(t).toISOString()}</lastmod>`;
}

/** 每個 spec × 每個語系輸出一個 `<url>`，各自帶完整的 `xhtml:link`（含自己與 x-default）。 */
export function renderUrlset(specs: readonly SitemapUrlSpec[], ctx: SitemapLocaleContext): string {
  const out: string[] = [
    XML_HEAD,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n',
  ];
  for (const spec of specs) {
    const query = spec.query ?? "";
    const links: string[] = ctx.supported.map(
      (l) =>
        `<xhtml:link rel="alternate" hreflang="${escapeXml(hreflangOf(l))}" href="${escapeXml(localizedUrl(ctx.origin, l, spec.path, query))}"/>`,
    );
    links.push(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(localizedUrl(ctx.origin, ctx.defaultLocale, spec.path, query))}"/>`,
    );
    const mod = lastmod(spec.lastModified);
    for (const l of ctx.supported) {
      out.push(`<url><loc>${escapeXml(localizedUrl(ctx.origin, l, spec.path, query))}</loc>${mod}${links.join("")}</url>\n`);
    }
  }
  out.push("</urlset>\n");
  return out.join("");
}

export function renderSitemapIndex(origin: string, names: readonly string[], lastModified?: Date): string {
  const mod = lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : "";
  const items = names.map((n) => `<sitemap><loc>${escapeXml(`${origin}/sitemap/${n}`)}</loc>${mod}</sitemap>\n`);
  return `${XML_HEAD}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("")}</sitemapindex>\n`;
}
