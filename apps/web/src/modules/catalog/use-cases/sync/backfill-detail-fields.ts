/**
 * backfill_detail_fields（GameDex 第二輪 Z4）：只為「已存在」的遊戲補詳情頁新欄位
 * （storyline、version_parent／version_title、game_modes、player_perspectives、game_engines）。
 * 依 games.igdb_id 升冪、每批 500 款，以 IGDB `where id = (...)` 只取這幾個欄位（fieldSet "detail"），
 * 經 writeGameBatch 的 detailOnly 模式寫入（不碰其他欄位、不寫 change_feed）。
 * 進度存 sync_state（jobName='igdb_backfill_detail'）的 cursor（JSON），每批寫完才推進 → 可續跑。
 * 手動執行：npm run job -- backfill_detail_fields [--max-batches N] [--restart]
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { listGameIgdbIdsAfter } from "../../repository/game-sync";
import { addStats } from "./backfill-games";
import { emptyBatchStats, GAMES_PAGE_SIZE, utcDate, writeGameBatch, type GameBatchStats, type WriteContext } from "./sync-games";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_BACKFILL_DETAIL_STATE = "igdb_backfill_detail";

export interface DetailBackfillCursor {
  /** 已處理到的 games.igdb_id。 */
  afterId: number;
  done: boolean;
  startedAt: string;
}

export interface DetailBackfillOptions {
  maxBatches?: number;
  restart?: boolean;
  pageSize?: number;
}

/** 解析 `npm run job -- backfill_detail_fields --max-batches 3 --restart`。 */
export function parseDetailBackfillArgs(args: readonly string[]): Pick<DetailBackfillOptions, "maxBatches" | "restart"> {
  const out: Pick<DetailBackfillOptions, "maxBatches" | "restart"> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--restart") out.restart = true;
    else if (a === "--max-batches" || a.startsWith("--max-batches=")) {
      const raw = a.includes("=") ? a.split("=")[1] : args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--max-batches 需要正整數：${raw ?? ""}`);
      out.maxBatches = n;
    } else throw new Error(`未知的參數：${a}（可用：--max-batches N、--restart）`);
  }
  return out;
}

export function parseDetailCursor(raw: string | null | undefined): DetailBackfillCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<DetailBackfillCursor>;
    if (typeof c.afterId !== "number" || typeof c.done !== "boolean") return null;
    return c as DetailBackfillCursor;
  } catch {
    return null;
  }
}

export interface DetailBackfillResult {
  cursor: DetailBackfillCursor;
  batches: number;
  run: GameBatchStats;
  totals: GameBatchStats;
  stoppedEarly: boolean;
}

export async function backfillDetailFields(
  provider: GameDataProvider,
  ctx: { startedAt: Date; log: Log },
  opts: DetailBackfillOptions = {},
): Promise<DetailBackfillResult> {
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const state = await getSyncState(IGDB_BACKFILL_DETAIL_STATE);
  let cursor = opts.restart ? null : parseDetailCursor(state?.cursor);
  let totals: GameBatchStats =
    cursor && state?.meta?.totals ? { ...emptyBatchStats(), ...(state.meta.totals as GameBatchStats) } : emptyBatchStats();

  if (!cursor) {
    cursor = { afterId: 0, done: false, startedAt: ctx.startedAt.toISOString() };
    totals = emptyBatchStats();
    ctx.log("詳情欄位回填開始");
  } else if (cursor.done) {
    ctx.log("詳情欄位回填已完成；要重跑請加 --restart", { cursor });
    return { cursor, batches: 0, run: emptyBatchStats(), totals, stoppedEarly: false };
  } else {
    ctx.log("從中斷處續傳", { cursor });
  }

  const wctx: WriteContext = {
    platforms: new Map(),
    regionIds: new Map(),
    today: utcDate(ctx.startedAt),
    log: ctx.log,
    detailOnly: true,
  };
  let run = emptyBatchStats();
  let batches = 0;
  let stoppedEarly = false;

  while (!cursor.done) {
    if (opts.maxBatches !== undefined && batches >= opts.maxBatches) {
      stoppedEarly = true;
      break;
    }
    const igdbIds = await listGameIgdbIdsAfter(cursor.afterId, pageSize);
    const batch = emptyBatchStats();
    if (igdbIds.length > 0) {
      const page = await provider.fetchGames({ ids: igdbIds, fieldSet: "detail", limit: pageSize });
      await writeGameBatch(page, wctx, batch);
    }
    run = addStats(run, batch);
    totals = addStats(totals, batch);
    batches += 1;
    // 寫完（或記為失敗）才推進；中斷時重做這一批是冪等的
    cursor = {
      ...cursor,
      afterId: igdbIds.length > 0 ? igdbIds[igdbIds.length - 1] : cursor.afterId,
      done: igdbIds.length < pageSize,
    };
    await saveSyncProgress(IGDB_BACKFILL_DETAIL_STATE, {
      cursor: JSON.stringify(cursor),
      meta: { totals, lastBatchAt: new Date().toISOString() },
      ...(cursor.done ? { lastSyncedAt: ctx.startedAt } : {}),
    });
    ctx.log("詳情欄位回填一批完成", {
      requested: igdbIds.length,
      fetched: batch.fetched,
      updated: batch.updated,
      failed: batch.failed,
      next: cursor,
    });
  }

  if (stoppedEarly) ctx.log("已達 --max-batches，停止；下次執行會續傳", { cursor });
  else ctx.log("詳情欄位回填完成", { ...totals });
  if (run.failed > 0) {
    throw new Error(
      `backfill_detail_fields：本次 ${run.failed} 款寫入失敗（id 見 sync_state[${IGDB_BACKFILL_DETAIL_STATE}].meta.totals.failedIgdbIds），cursor 已推進`,
    );
  }
  return { cursor, batches, run, totals, stoppedEarly };
}
