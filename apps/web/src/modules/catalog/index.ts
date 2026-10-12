// catalog 的公開 API。其他模組只能從這裡 import（02 §邊界規則 2）。
export * from "./domain/entities";
export { catalogModule, type ModuleManifest, type CatalogExtensions } from "./module";
export { getGameBySlug, getGameByIgdbId, upsertGame } from "./repository/games";
export { getReleaseEventsByMonth, upsertReleaseEvent } from "./repository/release-events";
export { getRatingsByGame, upsertRating } from "./repository/ratings";
export { listRegions, getRegionByCode } from "./repository/regions";
