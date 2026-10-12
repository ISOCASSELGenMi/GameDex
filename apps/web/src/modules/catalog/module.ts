import type { ModuleManifestBase } from "@/kernel/modules/types";

/**
 * catalog 的擴充點型別（02 §Manifest 與擴充點）。
 * RatingProvider／PopularitySignal／GameFilterProvider 的介面在需要它們的 Phase 才定義（4、3b、7），
 * 現在先保留欄位名稱，避免可選模組各自發明。
 */
export interface CatalogExtensions {
  ratingProviders?: unknown[];
  popularitySignals?: unknown[];
  gameFilters?: unknown[];
}

export type ModuleManifest = ModuleManifestBase & CatalogExtensions;

export const catalogModule: ModuleManifest = {
  name: "catalog",
  kind: "core",
  requires: [],
  requiredEnv: ["DATABASE_URL"],
  ownedTables: [
    "games", "platforms", "platform_families", "platform_release_dates", "regions", "game_platforms",
    "release_events", "release_date_history", "ratings", "score_snapshots", "external_ids",
    "external_match_attempts", "external_id_rejections", "companies", "game_companies", "franchises",
    "game_franchises", "game_similar_games", "game_external_links", "events", "event_series", "event_games",
    "genres", "themes", "game_genres", "game_themes", "game_localizations", "languages",
    "game_language_supports", "change_feed", "game_popularity_signals",
  ],
  jobs: [], // Phase 2 起加入 sync_games、sync_events、sync_platforms…
  i18nNamespaces: ["catalog"],
};
