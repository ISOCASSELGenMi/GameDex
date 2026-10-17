/**
 * GET /api/v1/games/search?q=&limit=1..20&locale=（07）：遊戲搜尋（選擇器用，例如手動指定匯入遊戲、加入清單）。公開、與使用者無關。
 * 回應 200 { items: GameMiniCard[] }；q 太短回空陣列；Cache-Control: public, s-maxage=60。
 * 400 { code: "q_required" }（沒帶 q）；查詢逾時 503 { code: "unavailable" }。薄路由 app/api/v1/games/search/route.ts。
 */
import { connection } from "next/server";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { isCatalogQueryTimeoutError } from "../domain/entities/read-errors";
import { searchGameCards } from "../use-cases/game-cards";

const Q_MAX = 200;

export async function GET(request: Request): Promise<Response> {
  await connection();
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q === null) return Response.json({ code: "q_required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const rawLocale = url.searchParams.get("locale");
  const locale = rawLocale && isSupportedLocale(rawLocale, getLocaleConfig()) ? rawLocale : null;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  try {
    const items = await searchGameCards(q.slice(0, Q_MAX), locale, Number.isFinite(limit) ? limit : undefined);
    return Response.json({ items }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  } catch (e) {
    if (isCatalogQueryTimeoutError(e)) {
      return Response.json({ code: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
    }
    throw e;
  }
}
