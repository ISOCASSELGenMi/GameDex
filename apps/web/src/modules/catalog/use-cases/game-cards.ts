/**
 * 其他模組顯示遊戲卡片、驗證平台、遊戲搜尋的唯讀 Use Case（Phase 7 第 5 波）。
 * 封面網址換算由 Provider（resolveImageRef）負責；搜尋字串與 06 搜尋共用 tokenizeForSearch。
 */
import { GAME_SEARCH_LIMIT_DEFAULT, GAME_SEARCH_LIMIT_MAX, type GameMiniCard, type GamePlatformOption, type PlatformBrief } from "../domain/entities";
import { tokenizeForSearch } from "../domain/search-text";
import { resolveImageRef } from "../providers/image-ref";
import { gameExists, gameHasPlatform, getGameMiniCardsByIds, getPlatformBriefsByIds as getPlatformBriefsByIdsRepo, listGamePlatformOptions, searchGameMiniCards } from "../repository/game-cards";

export { gameExists, gameHasPlatform };

/** 依 id 批次取迷你卡片（locale 為 null＝原名）。 */
export function getGameCardsByIds(ids: readonly number[], locale: string | null = null): Promise<Map<number, GameMiniCard>> {
  return getGameMiniCardsByIds(ids, locale, resolveImageRef);
}

/** 依 id 批次取平台簡述（名稱、縮寫）；不存在的 id 不在 Map 裡。 */
export function getPlatformBriefsByIds(ids: readonly number[]): Promise<Map<number, PlatformBrief>> {
  return getPlatformBriefsByIdsRepo(ids);
}

export function getGamePlatformOptions(gameId: number): Promise<GamePlatformOption[]> {
  return listGamePlatformOptions(gameId);
}

/** 遊戲搜尋（選擇器）：正規化後不到 2 字元回空陣列。 */
export async function searchGameCards(q: string, locale: string | null, limit: number = GAME_SEARCH_LIMIT_DEFAULT): Promise<GameMiniCard[]> {
  const tokens = tokenizeForSearch(q).slice(0, 200);
  if ([...tokens.replace(/\s+/g, "")].length < 2) return [];
  const n = Number.isFinite(limit) ? Math.min(GAME_SEARCH_LIMIT_MAX, Math.max(1, Math.floor(limit))) : GAME_SEARCH_LIMIT_DEFAULT;
  return searchGameMiniCards(tokens, n, locale, resolveImageRef);
}
