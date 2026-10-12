import { getCoreEnv } from "@/kernel/config/env";
import type { ModuleManifestBase } from "@/kernel/modules/types";
import { getIgdbProvider } from "./providers/igdb";
import { backfillGames, parseBackfillArgs } from "./use-cases/sync/backfill-games";
import { syncGames } from "./use-cases/sync/sync-games";
import { syncPlatforms } from "./use-cases/sync/sync-platforms";

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
  requiredEnv: ["DATABASE_URL", "IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET"],
  ownedTables: [
    "games", "platforms", "platform_families", "platform_release_dates", "regions", "game_platforms",
    "release_events", "release_date_history", "ratings", "score_snapshots", "external_ids",
    "external_match_attempts", "external_id_rejections", "companies", "game_companies", "franchises",
    "game_franchises", "game_similar_games", "game_external_links", "events", "event_series", "event_games",
    "genres", "themes", "game_genres", "game_themes", "game_localizations", "languages",
    "game_language_supports", "change_feed", "game_popularity_signals",
  ],
  // 頻率見 04 §排程任務
  jobs: [
    {
      // 手動：npm run job -- backfill_games [--max-batches N] [--restart]
      name: "backfill_games",
      lockMode: "session",
      run: async (ctx) => {
        const env = getCoreEnv();
        await backfillGames(getIgdbProvider({ maxReqPerSec: env.BACKFILL_MAX_REQ_PER_SEC }), ctx, {
          lookbackYears: env.BACKFILL_LOOKBACK_YEARS,
          ...parseBackfillArgs(ctx.args),
        });
      },
    },
    {
      name: "sync_games",
      cron: "10 * * * *", // 每小時
      run: async (ctx) => {
        await syncGames(getIgdbProvider(), ctx);
      },
    },
    {
      name: "sync_platforms",
      cron: "20 4 * * *", // 每日
      run: async (ctx) => {
        await syncPlatforms(getIgdbProvider(), ctx.log);
      },
    },
  ],
  i18nNamespaces: ["catalog"],
};
