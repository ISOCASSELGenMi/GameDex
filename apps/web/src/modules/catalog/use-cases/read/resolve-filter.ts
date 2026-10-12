import { getCoreEnv } from "@/kernel/config/env";
import type { IgnoredFilterValue, RegionCode, ReleaseFilter, ResolvedReleaseFilter } from "../../domain/entities";
import { normalizeRegionPref, normalizeReleaseFilter } from "../../domain/release-filter";
import { lookupFilterSlugs } from "../../repository/filter-options";

export interface ResolvedFilterResult {
  filter: ResolvedReleaseFilter;
  /** 未知 slug、未知 enum 值、超過 20 個的值（依輸入順序）。 */
  ignored: IgnoredFilterValue[];
}

/** 預設值來自環境變數（16）：CALENDAR_VISIBLE_GAME_TYPES、CALENDAR_VISIBLE_RELEASE_STAGES。 */
export function releaseFilterDefaults() {
  const env = getCoreEnv();
  return { gameTypes: env.CALENDAR_VISIBLE_GAME_TYPES, stages: env.CALENDAR_VISIBLE_RELEASE_STAGES };
}

/**
 * ReleaseFilter（slug）→ ResolvedReleaseFilter（id）。未知值忽略並回報，不 throw（06 §篩選：不回 500）。
 * 某維度的 slug 全部未知 → 該維度不限制（照樣回報）。
 */
export async function resolveFilterSlugs(filter: ReleaseFilter = {}): Promise<ResolvedFilterResult> {
  const n = normalizeReleaseFilter(filter, releaseFilterDefaults());
  const ignored = [...n.ignored];
  const found = await lookupFilterSlugs({ platformSlugs: n.platformSlugs ?? [], genreSlugs: n.genreSlugs ?? [] });

  const toIds = (slugs: string[] | undefined, map: Map<string, number>, dim: "platform" | "genre") => {
    if (!slugs) return undefined;
    const ids: number[] = [];
    for (const s of slugs) {
      const id = map.get(s);
      if (id == null) ignored.push({ dimension: dim, slug: s });
      else ids.push(id);
    }
    return ids.length > 0 ? ids : undefined;
  };
  const platformIds = toIds(n.platformSlugs, found.platforms, "platform");
  const genreIds = toIds(n.genreSlugs, found.genres, "genre");

  return {
    filter: {
      ...(platformIds ? { platformIds } : {}),
      ...(n.platformKinds ? { platformKinds: n.platformKinds } : {}),
      ...(genreIds ? { genreIds } : {}),
      stages: n.stages,
      gameTypes: n.gameTypes,
      statuses: n.statuses,
      includeRumored: n.includeRumored,
      // removed 不等於取消（D7、spec 04）：照常顯示，卡片帶 sourceStatus 讓 UI 加註「資料來源待確認」
      includeRemoved: true,
    },
    ignored,
  };
}

/** 地區偏好：傳入值（使用者設定或語系推導）無效時退回 DEFAULT_REGION_PREF，再退回 WW。 */
export function resolveRegionPref(code?: string | null): RegionCode {
  return normalizeRegionPref(code, getCoreEnv().DEFAULT_REGION_PREF);
}
