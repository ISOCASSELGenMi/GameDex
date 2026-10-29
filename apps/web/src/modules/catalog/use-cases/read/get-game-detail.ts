import { SITE_FOLLOWS_SIGNAL, type GameDetail } from "../../domain/entities";
import { displayFollowerCount, isRising, resolveFollowCountMinDisplay, resolveFollowRisingMin7d } from "../../domain/follow-display";
import { utcToday } from "../../domain/utc-date";
import { hasPopularitySignal } from "../../extensions";
import { getGameDetailBySlug } from "../../repository/game-detail";
import { getGameFollowHeat } from "../../repository/game-follow-heat";
import { resolveImageRef } from "../../providers/image-ref";
import { effectiveReleaseFilterDefaults, resolveRegionPref } from "./resolve-filter";

export interface GetGameDetailInput {
  slug: string;
  locale: string;
  /** regions.code；無效或未給 → DEFAULT_REGION_PREF。 */
  regionPref?: string | null;
}

/**
 * 遊戲詳情（06 §遊戲詳情頁；3a＋3b 語言支援 languageSupport＋Phase 4 ratings）。找不到回 null。
 * rumored 遊戲照常回傳（詳情頁可進入並標「傳聞」，04）。逾時丟 CatalogQueryTimeoutError。
 */
export async function getGameDetail(input: GetGameDetailInput): Promise<GameDetail | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 255) return null;
  const detail = await getGameDetailBySlug({
    slug,
    locale: input.locale,
    regionPref: resolveRegionPref(input.regionPref),
    franchiseGameTypes: (await effectiveReleaseFilterDefaults()).gameTypes,
    resolveImage: resolveImageRef,
  });
  if (!detail) return null;
  // 站內追蹤熱度：accounts 停用（沒有 site_follows 提供者）時不顯示人數、也沒有「上升中」
  if (!hasPopularitySignal(SITE_FOLLOWS_SIGNAL)) return { ...detail, followerCount: null, rising: false };
  const heat = await getGameFollowHeat({ gameId: detail.gameId, firstReleaseDate: detail.firstReleaseDate, todayUtc: utcToday() });
  return {
    ...detail,
    followerCount: displayFollowerCount(heat.followers, resolveFollowCountMinDisplay(process.env.FOLLOW_COUNT_MIN_DISPLAY)),
    rising: isRising(heat.followers7d, heat.percentRank, resolveFollowRisingMin7d(process.env.FOLLOW_RISING_MIN_7D)),
  };
}
