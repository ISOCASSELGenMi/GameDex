import { getCoreEnv } from "@/kernel/config/env";
import { getSettings } from "@/kernel/settings";
import { GAME_TYPES, RELEASE_STAGES, type IgnoredFilterValue, type RegionCode, type ReleaseFilter, type ResolvedReleaseFilter } from "../../domain/entities";
import { normalizeRegionPref, normalizeReleaseFilter, regionPrefIssue } from "../../domain/release-filter";
import { lookupFilterSlugs } from "../../repository/filter-options";

export interface ResolvedFilterResult {
  filter: ResolvedReleaseFilter;
  /** 未知 slug、未知 enum 值、超過 20 個的值（依輸入順序）。 */
  ignored: IgnoredFilterValue[];
}

/** 環境變數層的預設（16）：CALENDAR_VISIBLE_GAME_TYPES、CALENDAR_VISIBLE_RELEASE_STAGES。 */
export function releaseFilterDefaults() {
  const env = getCoreEnv();
  return { gameTypes: env.CALENDAR_VISIBLE_GAME_TYPES, stages: env.CALENDAR_VISIBLE_RELEASE_STAGES };
}

/**
 * 實際生效的預設：後台設定（DB，短 TTL 快取；12 §設定頁）有值就覆蓋環境變數。月曆、時間軸、瀏覽、公司／系列頁、詳情頁同系列共用。
 * 設定值在寫入時已驗證；這裡再過濾一次未知值，空清單視為沒設（否則預設會變成「什麼都不顯示」）。
 */
export async function effectiveReleaseFilterDefaults() {
  const base = releaseFilterDefaults();
  const s = await getSettings();
  const types = s.get("calendar.defaultGameTypes");
  const stages = s.get("calendar.defaultStages");
  return {
    gameTypes: Array.isArray(types) && types.length > 0 ? types.filter((x) => (GAME_TYPES as readonly string[]).includes(x)) : base.gameTypes,
    stages: Array.isArray(stages) && stages.length > 0 ? stages.filter((x) => (RELEASE_STAGES as readonly string[]).includes(x)) : base.stages,
  };
}

/**
 * ReleaseFilter（slug）→ ResolvedReleaseFilter（id）。未知值忽略並回報，不 throw（06 §篩選：不回 500）。
 * 某維度的 slug 全部未知 → 該維度不限制（照樣回報）。
 */
export async function resolveFilterSlugs(filter: ReleaseFilter = {}): Promise<ResolvedFilterResult> {
  const n = normalizeReleaseFilter(filter, await effectiveReleaseFilterDefaults());
  const ignored = [...n.ignored];
  const found = await lookupFilterSlugs({
    platformSlugs: n.platformSlugs ?? [],
    genreSlugs: n.genreSlugs ?? [],
    themeSlugs: n.themeSlugs ?? [],
    companySlugs: n.companySlugs ?? [],
    franchiseSlugs: n.franchiseSlugs ?? [],
  });

  const toIds = (
    slugs: string[] | undefined,
    map: Map<string, number | number[]>,
    dim: "platform" | "genre" | "theme" | "company" | "franchise",
  ) => {
    if (!slugs) return undefined;
    const ids: number[] = [];
    for (const s of slugs) {
      const id = map.get(s);
      if (id == null) ignored.push({ dimension: dim, slug: s });
      else if (Array.isArray(id)) ids.push(...id);
      else ids.push(id);
    }
    return ids.length > 0 ? ids : undefined;
  };
  const platformIds = toIds(n.platformSlugs, found.platforms, "platform");
  const genreIds = toIds(n.genreSlugs, found.genres, "genre");
  const themeIds = toIds(n.themeSlugs, found.themes, "theme");
  const companyIds = toIds(n.companySlugs, found.companies, "company");
  const franchiseIds = toIds(n.franchiseSlugs, found.franchises, "franchise");

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
      ...(themeIds ? { themeIds } : {}),
      ...(companyIds ? { companyIds } : {}),
      ...(franchiseIds ? { franchiseIds } : {}),
      ...(n.releaseStates ? { releaseStates: n.releaseStates } : {}),
      ...(n.minHeat !== undefined ? { minHeat: n.minHeat } : {}),
    },
    ignored,
  };
}

/**
 * 地區偏好＋提示：無效代碼退回預設，並回傳 ignored（dimension region），讓 UI「忽略並提示」。
 */
export function resolveRegionPrefWithNotice(code?: string | null): { regionPref: RegionCode; ignored: IgnoredFilterValue[] } {
  const issue = regionPrefIssue(code);
  return { regionPref: resolveRegionPref(issue ? null : code), ignored: issue ? [issue] : [] };
}

/** 地區偏好：傳入值（使用者設定或語系推導）無效時退回 DEFAULT_REGION_PREF，再退回 WW。 */
export function resolveRegionPref(code?: string | null): RegionCode {
  return normalizeRegionPref(code, getCoreEnv().DEFAULT_REGION_PREF);
}
