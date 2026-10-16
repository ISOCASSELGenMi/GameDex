/**
 * 外部遊戲庫比對用的唯讀查詢（Phase 7 第 3 波）：accounts 經 catalog/index.ts 呼叫，不碰 catalog 的表。
 */
import type { Candidate } from "../../domain/entities";
import { tokenizeForSearch } from "../../domain/search-text";
import { findCandidatesBySearchTokens, TITLE_CANDIDATE_LIMIT } from "../../repository/owned-game-matching";
import { normalizeTitle } from "./normalize-title";

export { findGameIdsByExternalIds, getGameBriefsByIds, TITLE_CANDIDATE_LIMIT, type GameBrief } from "../../repository/owned-game-matching";

/**
 * 依標題找比對候選（餵給 findBestMatch）。標題先 normalizeTitle（去商標符號、版本字尾），再走與 06 搜尋同一套 tokenizeForSearch。
 * 正規化後不到 2 個字元回空陣列（太短，trigram 沒有意義）。
 */
export async function findTitleMatchCandidates(title: string, limit: number = TITLE_CANDIDATE_LIMIT): Promise<Candidate[]> {
  const tokens = tokenizeForSearch(normalizeTitle(title));
  if ([...tokens.replace(/\s+/g, "")].length < 2) return [];
  return findCandidatesBySearchTokens(tokens, limit);
}
