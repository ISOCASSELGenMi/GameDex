/**
 * GET /api/v1/games/suggest?q=&locale=&limit=1..10（07）：搜尋框的候選名單。公開、與使用者無關。
 * 回應 200 { items: GameSuggestionDto[] }（每筆：slug、name、originalName、coverUrl、year、platforms）；
 * q 為空白回空陣列；Cache-Control: public, max-age=30, s-maxage=60。
 * 400 { code: "q_required" }（沒帶 q）；查詢逾時 503 { code: "unavailable" }。薄路由 app/api/v1/games/suggest/route.ts。
 */
import { connection } from "next/server";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { SUGGEST_LIMIT_DEFAULT } from "../domain/entities";
import { isCatalogQueryTimeoutError } from "../domain/entities/read-errors";
import { suggestGameCards } from "../use-cases/game-suggest";

export interface GameSuggestionDto {
  slug: string;
  name: string;
  originalName: string;
  coverUrl: string | null;
  year: number | null;
  platforms: string[];
}

export const GAME_SUGGEST_CACHE_CONTROL = "public, max-age=30, s-maxage=60";

export async function GET(request: Request): Promise<Response> {
  await connection();
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q === null) return Response.json({ code: "q_required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const rawLocale = url.searchParams.get("locale");
  const locale = rawLocale && isSupportedLocale(rawLocale, getLocaleConfig()) ? rawLocale : null;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  try {
    const cards = await suggestGameCards(q, locale, Number.isFinite(limit) ? limit : SUGGEST_LIMIT_DEFAULT);
    const items: GameSuggestionDto[] = cards.map((c) => ({
      slug: c.slug,
      name: c.name,
      originalName: c.originalName,
      coverUrl: c.cover?.small ?? null,
      year: c.year,
      platforms: c.platforms,
    }));
    return Response.json({ items }, { headers: { "Cache-Control": GAME_SUGGEST_CACHE_CONTROL } });
  } catch (e) {
    if (isCatalogQueryTimeoutError(e)) {
      return Response.json({ code: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
    }
    throw e;
  }
}
