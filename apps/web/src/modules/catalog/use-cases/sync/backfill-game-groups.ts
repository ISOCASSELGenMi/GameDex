/**
 * backfill_game_groups（Z6）：為既有遊戲補預先計算的欄位與表——games.release_group、games.publisher_group、release_picks。
 * 新遊戲與日後的變動由寫入路徑（syncIgdbGame、applyReleaseDiffPlan、upsertReleaseEvent）維護；這個任務只在 migration 0015 之後跑一次，
 * 或在 domain/publisher-groups.ts 名單／domain/game-group-keys.ts 規則改動後重跑（--restart）。不打 IGDB、不寫 change_feed。
 * 依 games.id 升冪、每批 1,000 款（一個 transaction），進度存 sync_state（jobName='game_groups_backfill'）的 cursor，每批寫完才推進 → 可續跑。
 * 全部完成後 VACUUM (ANALYZE) games／release_picks。
 * 手動執行：npm run job -- backfill_game_groups [--max-batches N] [--batch-size N] [--restart]
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import { GAME_GROUPS_BACKFILL_STATE, backfillGameGroupsBatch, vacuumAnalyzeBrowseTables } from "../../repository/game-groups";

export { GAME_GROUPS_BACKFILL_STATE };

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const GAME_GROUPS_BATCH_SIZE = 1000;

export interface GameGroupsBackfillCursor {
  /** 已處理到的 games.id。 */
  afterId: number;
  done: boolean;
  startedAt: string;
}

export interface GameGroupsBackfillOptions {
  maxBatches?: number;
  batchSize?: number;
  restart?: boolean;
}

export function parseGameGroupsBackfillArgs(args: readonly string[]): GameGroupsBackfillOptions {
  const out: GameGroupsBackfillOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--restart") out.restart = true;
    else if (a === "--max-batches" || a.startsWith("--max-batches=") || a === "--batch-size" || a.startsWith("--batch-size=")) {
      const name = a.startsWith("--max-batches") ? "maxBatches" : "batchSize";
      const raw = a.includes("=") ? a.split("=")[1] : args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${a.split("=")[0]} 需要正整數：${raw ?? ""}`);
      out[name] = n;
    } else throw new Error(`未知的參數：${a}（可用：--max-batches N、--batch-size N、--restart）`);
  }
  return out;
}

export function parseGameGroupsCursor(raw: string | null | undefined): GameGroupsBackfillCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<GameGroupsBackfillCursor>;
    if (typeof c.afterId !== "number" || typeof c.done !== "boolean") return null;
    return c as GameGroupsBackfillCursor;
  } catch {
    return null;
  }
}

export interface GameGroupsBackfillTotals {
  scanned: number;
  updated: number;
  picks: number;
}

export interface GameGroupsBackfillResult {
  cursor: GameGroupsBackfillCursor;
  batches: number;
  totals: GameGroupsBackfillTotals;
  stoppedEarly: boolean;
}

export async function backfillGameGroups(
  ctx: { startedAt: Date; log: Log },
  opts: GameGroupsBackfillOptions = {},
): Promise<GameGroupsBackfillResult> {
  const batchSize = opts.batchSize ?? GAME_GROUPS_BATCH_SIZE;
  const state = await getSyncState(GAME_GROUPS_BACKFILL_STATE);
  let cursor = opts.restart ? null : parseGameGroupsCursor(state?.cursor);
  let totals: GameGroupsBackfillTotals =
    cursor && state?.meta?.totals ? (state.meta.totals as GameGroupsBackfillTotals) : { scanned: 0, updated: 0, picks: 0 };

  if (!cursor) {
    cursor = { afterId: 0, done: false, startedAt: ctx.startedAt.toISOString() };
    totals = { scanned: 0, updated: 0, picks: 0 };
    ctx.log("分組鍵／代表上市列回填開始");
  } else if (cursor.done) {
    ctx.log("分組鍵回填已完成；要重跑請加 --restart", { cursor });
    return { cursor, batches: 0, totals, stoppedEarly: false };
  } else {
    ctx.log("從中斷處續傳", { cursor });
  }

  let batches = 0;
  let stoppedEarly = false;
  while (!cursor.done) {
    if (opts.maxBatches !== undefined && batches >= opts.maxBatches) {
      stoppedEarly = true;
      break;
    }
    const r = await backfillGameGroupsBatch(cursor.afterId, batchSize);
    totals = { scanned: totals.scanned + r.scanned, updated: totals.updated + r.updated, picks: totals.picks + r.picks };
    batches += 1;
    cursor = { ...cursor, afterId: r.lastId ?? cursor.afterId, done: r.scanned < batchSize };
    await saveSyncProgress(GAME_GROUPS_BACKFILL_STATE, {
      cursor: JSON.stringify(cursor),
      meta: { totals, lastBatchAt: new Date().toISOString() },
      ...(cursor.done ? { lastSyncedAt: ctx.startedAt } : {}),
    });
    if (batches % 20 === 0 || cursor.done) ctx.log("回填進度", { batches, next: cursor, ...totals });
  }

  if (stoppedEarly) {
    ctx.log("已達 --max-batches，停止；下次執行會續傳", { cursor });
  } else {
    ctx.log("分組鍵／代表上市列回填完成，更新統計（VACUUM ANALYZE）", { ...totals });
    await vacuumAnalyzeBrowseTables();
  }
  return { cursor, batches, totals, stoppedEarly };
}
