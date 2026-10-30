/**
 * GET /api/v1/games/group?locale=&by=date|platform|publisher&key=&offset=&limit=&<篩選參數，含 q、sort、year>：
 * 瀏覽頁分組檢視某一組接續的卡片（「顯示更多」按需載入）。薄路由 app/api/v1/games/group/route.ts。公開、與使用者無關，可被 CDN 快取。
 *
 * - 篩選與頁面同一組 query（`parseFilterSpec`＋瀏覽頁的參數規則）；查詢規則由 Use Case `getGameGroupPage` 執行。
 * - **組內順序固定＝發售日由新到舊**（未定日期最後，再依熱度、id）：`sort` 參數被忽略（頁面產生的網址也不帶），
 *   組排序（`gsort`／`gdir`）與日期分組的起算月（`gfrom`）只決定「頁面上有哪些組、什麼順序」，與「某一組的卡片」無關，所以這個 API 不吃它們（帶了也忽略）。
 * - `by` 缺少或未知（含 none）＝400；`key`：date＝YYYY-MM／YYYY-Qn／YYYY／tbd、platform＝平台 slug、publisher＝廠商欄 key。
 * - `offset` 預設 0；`limit` 預設 GAME_GROUP_MORE、最多 GAME_GROUP_MAX_LIMIT。
 * - 回應 200 `{ key, total, cards: GroupCardData[] }`；400 `{ error: "invalid_locale" | "invalid_by" | "invalid_key" | "invalid_paging" }`；查詢逾時 503 `{ error: "timeout" }`。
 * - 讀 DB 的 GET：先 `await connection()`（Next 16.4 cacheComponents）。
 */
import { connection } from "next/server";
import { parseFilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { GAME_GROUP_MAX_LIMIT, GAME_GROUP_MORE } from "../../../domain/entities";
import { isCatalogQueryTimeoutError } from "../../../domain/entities/read-errors";
import { isGroupKey } from "../../../use-cases/read";
import { filterSpecForPage } from "../../filters/filter-labels";
import { loadGroupMore } from "./groups-server";
import { isGrouped, parseGameGroupBy } from "./params";

/** 公開快取：瀏覽器 60 秒、CDN 5 分鐘（與頁面同一份資料來源，同步後最多落後這個時間）。 */
export const GAME_GROUP_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? GAME_GROUP_CACHE_CONTROL : "no-store", ...(status === 503 ? { "Retry-After": "30" } : {}) },
  });
}

function intParam(value: string | null, fallback: number): number | null {
  if (value === null || value === "") return fallback;
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

export async function gameGroupResponse(request: Request): Promise<Response> {
  await connection();
  const params = new URL(request.url).searchParams;
  const rawLocale = params.get("locale") ?? "";
  if (!isSupportedLocale(rawLocale, getLocaleConfig())) return json({ error: "invalid_locale" }, 400);
  const locale = rawLocale as Locale;

  const by = parseGameGroupBy(params.get("by"));
  if (!isGrouped(by)) return json({ error: "invalid_by" }, 400);
  const key = params.get("key") ?? "";
  if (!isGroupKey(by, key)) return json({ error: "invalid_key" }, 400);

  const offset = intParam(params.get("offset"), 0);
  const limit = intParam(params.get("limit"), GAME_GROUP_MORE);
  if (offset === null || limit === null || limit < 1 || limit > GAME_GROUP_MAX_LIMIT) return json({ error: "invalid_paging" }, 400);

  try {
    const spec = filterSpecForPage(parseFilterSpec(params).filter, "browse");
    return json(await loadGroupMore({ locale, spec, by, key, offset, limit }));
  } catch (err) {
    if (isCatalogQueryTimeoutError(err)) return json({ error: "timeout" }, 503);
    throw err;
  }
}
