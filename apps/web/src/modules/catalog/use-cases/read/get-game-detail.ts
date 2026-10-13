import type { GameDetail } from "../../domain/entities";
import { getGameDetailBySlug } from "../../repository/game-detail";
import { resolveImageRef } from "../../providers/image-ref";
import { releaseFilterDefaults, resolveRegionPref } from "./resolve-filter";

export interface GetGameDetailInput {
  slug: string;
  locale: string;
  /** regions.code；無效或未給 → DEFAULT_REGION_PREF。 */
  regionPref?: string | null;
}

/**
 * 遊戲詳情（06 §遊戲詳情頁；3a＋3b 語言支援 languageSupport，評分區留空）。找不到回 null。
 * rumored 遊戲照常回傳（詳情頁可進入並標「傳聞」，04）。逾時丟 CatalogQueryTimeoutError。
 */
export async function getGameDetail(input: GetGameDetailInput): Promise<GameDetail | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 255) return null;
  return getGameDetailBySlug({
    slug,
    locale: input.locale,
    regionPref: resolveRegionPref(input.regionPref),
    franchiseGameTypes: releaseFilterDefaults().gameTypes,
    resolveImage: resolveImageRef,
  });
}
