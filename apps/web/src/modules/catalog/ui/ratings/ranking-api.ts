/**
 * GET /api/v1/ratings/ranking?locale=&<篩選參數>&sort=&dir=&minVotes=&page=&prev=&chunk=1：評分排名（切換排序、載入更多時按需載入）。
 * 薄路由 app/api/v1/ratings/ranking/route.ts。公開、與使用者無關，可被 CDN 快取。
 *
 * - 篩選與評分排名頁同一組（`parseFilterSpec` → `filterSpecForPage(…, "ratings")` → `filterSpecToReadQuery`）。
 * - `sort`：欄位 id（igdb、以及已啟用模組註冊的欄位）；未知或停用 → 預設欄。`dir`：desc（預設）｜asc。
 * - `minVotes`：排序欄的最低票數（0~100000）；省略＝該欄預設。
 * - `page`：1~20。預設累計（前 page 頁）；`chunk=1` 只回第 page 頁（載入更多）。
 * - `prev`：前一個排序欄 id；有給時每列帶 `prevRank`（相對上一個排序標準的名次）。
 * - 200 `RatingsRankingResponse`；400 `{ error: "invalid_locale" }`；查詢逾時 503 `{ error: "timeout" }`。
 * - 讀 DB 的 GET：先 `await connection()`（Next 16.4 cacheComponents）。
 */
import { connection } from "next/server";
import { parseFilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { isCatalogQueryTimeoutError } from "../../domain/entities/read-errors";
import { parseRatingsParams } from "../../domain/ratings-ranking";
import { getRatingColumns, getRatingsRanking } from "../../use-cases/read";
import { filterSpecToReadQuery } from "../filter-mapping";
import { filterSpecForPage } from "../filters/filter-labels";
import { toRankingResponse } from "./view-model";

export const RATINGS_RANKING_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? RATINGS_RANKING_CACHE_CONTROL : "no-store", ...(status === 503 ? { "Retry-After": "30" } : {}) },
  });
}

export async function ratingsRankingResponse(request: Request): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const rawLocale = params.get("locale") ?? "";
  if (!isSupportedLocale(rawLocale, getLocaleConfig())) return json({ error: "invalid_locale" }, 400);
  const locale = rawLocale as Locale;
  const rq = filterSpecToReadQuery(filterSpecForPage(parseFilterSpec(params).filter, "ratings"));
  const rp = parseRatingsParams(Object.fromEntries(params), getRatingColumns());
  try {
    const result = await getRatingsRanking({
      filter: rq.filter,
      yearFrom: rq.yearFrom,
      yearTo: rq.yearTo,
      sort: rp.sort,
      dir: rp.dir,
      minVotes: rp.minVotes,
      prev: rp.prev,
      page: rp.page,
      cumulative: params.get("chunk") !== "1",
      locale,
    });
    return json(toRankingResponse(result, rp.page, locale));
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) return json({ error: "timeout" }, 503);
    throw err;
  }
}
