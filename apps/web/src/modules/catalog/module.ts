import { getCoreEnv } from "@/kernel/config/env";
import type { ModuleManifestBase } from "@/kernel/modules/types";
import type { PopularitySignal } from "./domain/entities";
import { getIgdbProvider } from "./providers/igdb";
import { backfillGames, parseBackfillArgs } from "./use-cases/sync/backfill-games";
import { checkDictionaryDrift } from "./use-cases/sync/dictionary-drift";
import { parseRefreshPopularityArgs, refreshPopularity } from "./use-cases/sync/refresh-popularity";
import { resolveRelations } from "./use-cases/sync/resolve-relations";
import { rollingRefresh } from "./use-cases/sync/rolling-refresh";
import { syncEvents } from "./use-cases/sync/sync-events";
import { syncGames } from "./use-cases/sync/sync-games";
import { syncPlatforms } from "./use-cases/sync/sync-platforms";

/**
 * catalog 的擴充點型別（02 §Manifest 與擴充點）。
 * RatingProvider／GameFilterProvider 的介面在需要它們的 Phase 才定義（4、7），現在先保留欄位名稱，避免可選模組各自發明。
 * PopularitySignal 於 3b 定義（domain/entities/popularity.ts）。
 */
export interface CatalogExtensions {
  ratingProviders?: unknown[];
  popularitySignals?: PopularitySignal[];
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
      // 手動：npm run job -- backfill_games [--tier 1|2] [--max-batches N] [--restart]
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
    {
      name: "sync_events",
      cron: "25 */6 * * *", // 每 6 小時
      run: async (ctx) => {
        await syncEvents(getIgdbProvider(), ctx);
      },
    },
    {
      name: "resolve_relations",
      cron: "40 4 * * *", // 每日（sync_platforms 之後）；回填每批後另外跑局部解析
      run: async (ctx) => {
        await resolveRelations(ctx);
      },
    },
    {
      name: "rolling_refresh",
      cron: "30 3 * * *", // 每晚
      lockMode: "session",
      run: async (ctx) => {
        const provider = getIgdbProvider({ maxReqPerSec: getCoreEnv().BACKFILL_MAX_REQ_PER_SEC });
        await checkDictionaryDrift(provider, ctx.log);
        await rollingRefresh(provider, ctx, { perNight: getCoreEnv().ROLLING_REFRESH_PER_NIGHT });
      },
    },
    {
      // 每小時：upcoming 群；距上次全量 ≥ 23 小時則兩群都算（released 每日）。手動：npm run job -- refresh_popularity [--scope all|upcoming] [--force-hype]
      // IGDB 全量重抓約 211 個請求（額外限速 BACKFILL_MAX_REQ_PER_SEC，額度留給 sync_games），可能超過 1 分鐘 → session lock
      name: "refresh_popularity",
      cron: "50 * * * *",
      lockMode: "session",
      run: async (ctx) => {
        const env = getCoreEnv();
        await refreshPopularity(getIgdbProvider({ maxReqPerSec: env.BACKFILL_MAX_REQ_PER_SEC }), ctx, {
          coldStartFollows: env.HEAT_COLD_START_FOLLOWS,
          // 外部訊號（accounts 的 site_follows）要由 registry 收集已啟用模組的 popularitySignals 後注入；目前沒有提供者
          externalSignals: [],
          ...parseRefreshPopularityArgs(ctx.args),
        });
      },
    },
  ],
  i18nNamespaces: ["catalog"],
};
