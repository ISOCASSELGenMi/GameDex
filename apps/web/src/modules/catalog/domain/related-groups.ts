/**
 * 詳情頁「相關內容」分組的對照（GameDex 第二輪 Z4）：唯一實作。
 * editions 來自 version_parent（不看 game_type）；其餘依 parent_game 反查後以 game_type 分組。
 * IGDB 沒有提供「本作被哪些合輯包含」的資料，bundles 只含 parent_game 指向本作的 bundle 型別遊戲（通常為空）。
 */
import type { GameType } from "./entities/enums";
import type { RelatedGroupKey } from "./entities/game-detail-extra";

/** 每組最多帶出幾款（total 仍為實際總數）。 */
export const RELATED_GROUP_LIMIT = 24;

/** game_type → 相關內容組；沒列出的類型（main_game、other）不進任何組。 */
export const RELATED_GROUP_BY_GAME_TYPE: Readonly<Partial<Record<GameType, RelatedGroupKey>>> = {
  expanded_game: "expanded_games",
  dlc_addon: "dlcs",
  expansion: "expansions",
  standalone_expansion: "standalone_expansions",
  remake: "remakes",
  remaster: "remasters",
  port: "ports",
  bundle: "bundles",
  episode: "episodes",
  season: "episodes",
  pack: "packs",
  update: "packs",
  mod: "packs",
  fork: "packs",
};

/** 反向：組 → 該組涵蓋的 game_type（查詢用）。 */
export function gameTypesOfRelatedGroup(key: RelatedGroupKey): GameType[] {
  return (Object.entries(RELATED_GROUP_BY_GAME_TYPE) as Array<[GameType, RelatedGroupKey]>)
    .filter(([, k]) => k === key)
    .map(([t]) => t);
}

/** 沒有 game_type（NULL）視為 main_game，不進任何組。 */
export function relatedGroupOfGameType(gameType: string | null | undefined): RelatedGroupKey | null {
  return RELATED_GROUP_BY_GAME_TYPE[(gameType ?? "main_game") as GameType] ?? null;
}
