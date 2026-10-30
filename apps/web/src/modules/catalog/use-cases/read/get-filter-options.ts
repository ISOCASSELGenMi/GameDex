import { BROWSE_SORTS, GAME_TYPES, RELEASE_STAGES, RELEASE_STATE_FILTERS, type FilterOptions } from "../../domain/entities";
import { PLATFORM_GROUP_KINDS } from "../../domain/platform-groups";
import { normalizeReleaseFilter } from "../../domain/release-filter";
import { listGenreOptions, listPlatformOptions, listRegionCodes, listThemeOptions } from "../../repository/filter-options";
import { effectiveReleaseFilterDefaults } from "./resolve-filter";

export interface GetFilterOptionsInput {
  /** 目前選項名稱都是原文（平台是專有名詞；genres 由 UI 字典翻譯）；保留參數以便日後依語系排序。 */
  locale: string;
  /** 「近期」的中心日（UTC）；預設今天。 */
  today?: Date;
}

/** 篩選面板的選項（06 §篩選）。MVP 不做即時 facet 計數。 */
export async function getFilterOptions(input: GetFilterOptionsInput): Promise<FilterOptions> {
  void input.locale;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const defaults = normalizeReleaseFilter({}, await effectiveReleaseFilterDefaults());
  const [platforms, genres, themes, regions] = await Promise.all([
    listPlatformOptions(today),
    listGenreOptions(),
    listThemeOptions(),
    listRegionCodes(),
  ]);
  return {
    platforms,
    platformKinds: [...PLATFORM_GROUP_KINDS],
    genres,
    stages: [...RELEASE_STAGES],
    defaultStages: defaults.stages,
    defaultGameTypes: defaults.gameTypes,
    themes,
    gameTypes: [...GAME_TYPES],
    releaseStates: [...RELEASE_STATE_FILTERS],
    regions,
    sorts: [...BROWSE_SORTS],
  };
}
