/**
 * 搜尋候選（GET /api/v1/games/suggest）。字串正規化與 06 搜尋共用 tokenizeForSearch（原則五）；
 * 封面網址換算由 Provider（resolveImageRef）負責。
 */
import { SUGGEST_LIMIT_DEFAULT, SUGGEST_LIMIT_MAX, type GameSuggestion } from "../domain/entities";
import { tokenizeForSearch } from "../domain/search-text";
import { resolveImageRef } from "../providers/image-ref";
import { suggestGames } from "../repository/game-suggest";

const Q_MAX = 100;

/** 正規化後空白 → 空陣列；limit 夾在 1..SUGGEST_LIMIT_MAX。 */
export async function suggestGameCards(q: string, locale: string | null, limit: number = SUGGEST_LIMIT_DEFAULT): Promise<GameSuggestion[]> {
  const trimmed = q.trim().slice(0, Q_MAX);
  const tokens = tokenizeForSearch(trimmed);
  if (!tokens.replace(/\s+/g, "")) return [];
  const exact = trimmed.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  const n = Number.isFinite(limit) ? Math.min(SUGGEST_LIMIT_MAX, Math.max(1, Math.floor(limit))) : SUGGEST_LIMIT_DEFAULT;
  return suggestGames({ tokens, exact, locale, limit: n }, resolveImageRef);
}
