import { PLATFORM_KINDS, RELEASE_STAGES, type FilterOptions } from "../../domain/entities";
import { normalizeReleaseFilter } from "../../domain/release-filter";
import { listGenreOptions, listPlatformOptions } from "../../repository/filter-options";
import { releaseFilterDefaults } from "./resolve-filter";

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
  const defaults = normalizeReleaseFilter({}, releaseFilterDefaults());
  const [platforms, genres] = await Promise.all([listPlatformOptions(today), listGenreOptions()]);
  return {
    platforms,
    platformKinds: PLATFORM_KINDS.filter((k) => k !== "mobile"),
    genres,
    stages: [...RELEASE_STAGES],
    defaultStages: defaults.stages,
    defaultGameTypes: defaults.gameTypes,
  };
}
