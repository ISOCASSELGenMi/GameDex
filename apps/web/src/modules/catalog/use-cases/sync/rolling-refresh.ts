/**
 * rolling_refresh（04 §滾動校對）：每晚挑 lastFullSyncAt 最舊的 N 款，以 id 清單重抓（每請求 500 個），
 * 用完整 diff 寫回（markMissingRemoved: true）。不依賴任何 IGDB 行為假設，兜底增量同步漏掉的變動。
 *
 * 監控 rolling_refresh_misses（寫入 sync_state[rolling_refresh].meta）：
 *   上市日與資料庫不同（新增、日期／階段改變、removed／restored），且「不在最近增量名單內」的遊戲數。
 *   「不在最近增量名單內」＝來源 updated_at ≤ 增量同步進度（igdb_games.lastSyncedAt）：
 *   照理增量同步已抓過這個版本，卻仍有差異 → 來源改了上市日但沒推進 games.updated_at。
 *   來源 updated_at 晚於增量進度的，只是增量還沒跑到，不算。沒有增量進度時無法判斷，記 null。
 *   長期為 0 → 輪詢夠用；不為 0 → 加 release_dates.updated_at 輪詢。
 *
 * 來源以 id 查不到的遊戲（已刪除）：保留遊戲，尚未上市的上市列標 removed（2026-10-13 使用者決定）。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { markIgdbGameMissing } from "../../repository/game-sync";
import { listGamesForRefresh, touchLastFullSync } from "../../repository/games";
import { emptyBatchStats, GAMES_PAGE_SIZE, IGDB_GAMES_STATE, isMobileOnly, loadWriteContext, writeGameBatch } from "./sync-games";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const ROLLING_REFRESH_STATE = "rolling_refresh";
/** meta 裡最多保留幾個 id（misses、missing、failed）。 */
const IDS_KEEP = 200;

export interface RollingRefreshOptions {
  perNight: number;
  pageSize?: number;
}

export interface RollingRefreshResult {
  selected: number;
  fetched: number;
  written: number;
  failed: number;
  failedIgdbIds: number[];
  /** 上市日與資料庫不同的遊戲數（不論原因）。 */
  changedGames: number;
  /** null＝沒有增量同步進度，無法判斷。 */
  rolling_refresh_misses: number | null;
  missIgdbIds: number[];
  /** 來源查不到的遊戲。 */
  missingIgdbIds: number[];
  missingReleasesRemoved: number;
  skippedMobileOnly: number;
  releasesCreated: number;
  releasesUpdated: number;
  releasesRemoved: number;
  releasesRestored: number;
}

/** 這款的差異算不算 miss：來源版本不晚於增量進度（增量理應已抓過）。 */
export function isRefreshMiss(sourceUpdatedAt: Date | null, incrementalSince: Date): boolean {
  return sourceUpdatedAt === null || sourceUpdatedAt.getTime() <= incrementalSince.getTime();
}

export async function rollingRefresh(
  provider: GameDataProvider,
  ctx: { startedAt: Date; log: Log },
  opts: RollingRefreshOptions,
): Promise<RollingRefreshResult> {
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const targets = await listGamesForRefresh(opts.perNight);
  const incrementalSince = (await getSyncState(IGDB_GAMES_STATE))?.lastSyncedAt ?? null;
  if (!incrementalSince) ctx.log("尚無增量同步進度，本次不計算 rolling_refresh_misses");

  const stats = emptyBatchStats();
  let changedGames = 0;
  const missIgdbIds: number[] = [];
  const wctx = {
    ...(await loadWriteContext(ctx.startedAt, ctx.log)),
    markMissingRemoved: true,
    onWritten: (record: { igdbId: number; sourceUpdatedAt: Date | null }, res: { releases: { sourceChanges: number } }) => {
      if (res.releases.sourceChanges === 0) return;
      changedGames += 1;
      if (incrementalSince && isRefreshMiss(record.sourceUpdatedAt, incrementalSince)) missIgdbIds.push(record.igdbId);
    },
  };

  const missingIgdbIds: number[] = [];
  let missingReleasesRemoved = 0;
  for (let i = 0; i < targets.length; i += pageSize) {
    const chunk = targets.slice(i, i + pageSize);
    const records = await provider.fetchGames({ ids: chunk.map((t) => t.igdbId), limit: pageSize });
    await writeGameBatch(records, wctx, stats);

    const returned = new Map(records.map((r) => [r.igdbId, r]));
    const skipped: number[] = [];
    for (const t of chunk) {
      const r = returned.get(t.igdbId);
      if (!r) {
        missingIgdbIds.push(t.igdbId);
        missingReleasesRemoved += await markIgdbGameMissing(t.id, t.igdbId, { today: wctx.today });
      } else if (isMobileOnly(r, wctx)) skipped.push(t.id);
    }
    await touchLastFullSync(skipped);
  }

  const result: RollingRefreshResult = {
    selected: targets.length,
    fetched: stats.fetched,
    written: stats.inserted + stats.updated,
    failed: stats.failed,
    failedIgdbIds: stats.failedIgdbIds.slice(0, IDS_KEEP),
    changedGames,
    rolling_refresh_misses: incrementalSince ? missIgdbIds.length : null,
    missIgdbIds: missIgdbIds.slice(0, IDS_KEEP),
    missingIgdbIds: missingIgdbIds.slice(0, IDS_KEEP),
    missingReleasesRemoved,
    skippedMobileOnly: stats.skippedMobileOnly,
    releasesCreated: stats.releasesCreated,
    releasesUpdated: stats.releasesUpdated,
    releasesRemoved: stats.releasesRemoved,
    releasesRestored: stats.releasesRestored,
  };
  if (missingIgdbIds.length > 0) {
    ctx.log("來源查不到的遊戲：已保留遊戲、未上市的上市列標 removed", { count: missingIgdbIds.length, igdbIds: result.missingIgdbIds });
  }
  ctx.log("滾動校對完成", { ...result, incrementalSince: incrementalSince?.toISOString() ?? null });
  // 失敗的遊戲 lastFullSyncAt 沒推進，明晚會再被挑到
  await saveSyncProgress(ROLLING_REFRESH_STATE, { lastSyncedAt: ctx.startedAt, meta: { ...result } });
  if (stats.failed > 0) throw new Error(`rolling_refresh：${stats.failed} 款遊戲寫入失敗（見 log）`);
  return result;
}
