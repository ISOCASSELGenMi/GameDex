/**
 * sitemap index、sitemap 分片、robots.txt 的回應產生（薄路由 app/sitemap.xml、app/sitemap/[name]、app/robots.txt 呼叫）。
 *
 * - 資料經 Use Case（分層：不直接碰 Repository）。
 * - 分片的 XML 很大（單片數萬個 `<url>`），不放進 `use cache`（會擠爆伺服器記憶體快取）；
 *   快取交給 CDN：`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`（見 infra/cloudflare/cache-rules.md）。
 *   只有「各實體數量」（很小）進 `use cache`，讓 index 與分片的存在檢查不必每次掃全表。
 * - 絕對網址的 origin：NEXT_PUBLIC_SITE_URL；沒設時退回請求的 origin（本機、e2e）。
 */
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import type { SitemapCounts } from "../../domain/entities";
import { isCatalogQueryTimeoutError } from "../../domain/entities/read-errors";
import { getSitemapCounts, listSitemapEntries, listSitemapSmall } from "../../use-cases/read/sitemap";
import { QueryTimeoutPageError, timeoutMarkerOrRethrow, unwrapCachedForPage, type CachedTimeout } from "../page-errors";
import { siteOrigin } from "./site-url";
import type { SeoLocaleConfig } from "./metadata";
import {
  entitiesPerShard,
  pageSpecs,
  parseShardName,
  planShards,
  renderSitemapIndex,
  renderUrlset,
  shardCount,
  specsForKind,
} from "./sitemap";

const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};
const NOT_FOUND_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=60" };

async function readCountsCached(): Promise<SitemapCounts | CachedTimeout> {
  "use cache";
  try {
    const counts = await getSitemapCounts();
    cacheLife("catalogSitemap");
    return counts;
  } catch (err) {
    // 逾時要在快取邊界內攔下（跨過邊界後型別會遺失，見 page-errors.ts）；failure() 再轉成 503
    const marker = timeoutMarkerOrRethrow(err);
    cacheLife("seconds");
    return marker;
  }
}

async function readCounts(): Promise<SitemapCounts> {
  return unwrapCachedForPage(await readCountsCached());
}

function originOf(request: Request): string {
  return siteOrigin() ?? new URL(request.url).origin;
}

function failure(err: unknown): Response {
  if (isCatalogQueryTimeoutError(err) || err instanceof QueryTimeoutPageError) {
    return new Response("temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
  throw err;
}

export async function sitemapIndexResponse(request: Request, config: SeoLocaleConfig): Promise<Response> {
  await connection();
  try {
    const counts = await readCounts();
    const names = planShards(counts, config.supported.length);
    return new Response(renderSitemapIndex(originOf(request), names), { headers: XML_HEADERS });
  } catch (err) {
    return failure(err);
  }
}

export async function sitemapShardResponse(request: Request, name: string, config: SeoLocaleConfig): Promise<Response> {
  const parsed = parseShardName(name);
  if (!parsed) return new Response("not found", { status: 404, headers: NOT_FOUND_HEADERS });
  await connection();
  const ctx = { origin: originOf(request), supported: config.supported, defaultLocale: config.defaultLocale };
  try {
    if (parsed.type === "pages") {
      const small = await listSitemapSmall();
      const specs = pageSpecs({ now: new Date(), platforms: small.platforms, events: small.events });
      return new Response(renderUrlset(specs, ctx), { headers: XML_HEADERS });
    }
    const per = entitiesPerShard(config.supported.length);
    const counts = await readCounts();
    if (parsed.shard >= shardCount(counts[parsed.kind], per)) {
      return new Response("not found", { status: 404, headers: NOT_FOUND_HEADERS });
    }
    const entries = await listSitemapEntries({ kind: parsed.kind, shard: parsed.shard, perShard: per });
    if (entries.length === 0) return new Response("not found", { status: 404, headers: NOT_FOUND_HEADERS });
    return new Response(renderUrlset(specsForKind(parsed.kind, entries), ctx), { headers: XML_HEADERS });
  } catch (err) {
    return failure(err);
  }
}

/** robots.txt：不擋篩選頁（它們靠 meta noindex，擋了爬蟲就看不到）；擋 API 與內部端點。 */
export async function robotsResponse(request: Request): Promise<Response> {
  await connection();
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /internal/",
    "Disallow: /ical/u/",
    "",
    `Sitemap: ${originOf(request)}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
