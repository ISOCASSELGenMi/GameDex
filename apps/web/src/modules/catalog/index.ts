// catalog 的公開 API。其他模組只能從這裡 import（02 §邊界規則 2）。
export * from "./domain/entities";
export { catalogModule, type ModuleManifest, type CatalogExtensions } from "./module";
export { getGameBySlug, getGameByIgdbId, upsertGame } from "./repository/games";
export { getReleaseEventsByMonth, upsertReleaseEvent } from "./repository/release-events";
export { getRatingsByGame, upsertRating } from "./repository/ratings";
export { listRegions, getRegionByCode } from "./repository/regions";

// ── 讀取（Phase 3a：月曆、詳情、篩選）─────────────────────────────────
export * from "./use-cases/read";
export {
  normalizeReleaseFilter,
  normalizeRegionPref,
  monthBounds,
  MAX_FILTER_VALUES,
  DEFAULT_RELEASE_STATUSES,
  type NormalizedReleaseFilter,
  type ReleaseFilterDefaults,
} from "./domain/release-filter";
export { regionPrefIssue } from "./domain/release-filter";
