/**
 * backfill_games（04 §回填）：手動執行的長任務（session lock）。目前只有 Tier 1：
 *   (a) recent：first_release_date >= 開始時往回 BACKFILL_LOOKBACK_YEARS 年，限白名單類型
 *   (b) undated：first_release_date = null & release_dates != null，限白名單類型（D62：沒有上市日的留給 Tier 2）
 * 進度存 sync_state（jobName='igdb_backfill'）的 cursor（JSON），每批寫完才更新 → 中斷後從下一批續傳。
 * 回填只 upsert、不標 removed；寫入與增量同步共用 writeGameBatch。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import { WHITELIST_GAME_TYPES, type FetchGamesQuery } from "../../domain/entities";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { emptyBatchStats, GAMES_PAGE_SIZE, loadWriteContext, writeGameBatch, type GameBatchStats } from "./sync-games";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_BACKFILL_STATE = "igdb_backfill";
/** meta 裡最多保留幾個失敗 id。 */
const FAILED_IDS_KEEP = 500;

export type BackfillPhase = "recent" | "undated" | "done";

export interface BackfillCursor {
  tier: 1;
  phase: BackfillPhase;
  /** 目前階段已處理到的 igdbId（id 升冪）。 */
  afterId: number;
  /** (a) 的下限，第一次開始時固定，續傳沿用。 */
  firstReleaseFrom: string;
  startedAt: string;
}

export interface BackfillOptions {
  lookbackYears: number;
  /** 本次最多處理幾批（測試、分段執行用）；未給＝做到完。 */
  maxBatches?: number;
  /** 丟掉既有進度，從頭開始。 */
  restart?: boolean;
  pageSize?: number;
}

/** 解析 `npm run job -- backfill_games --max-batches 3 --restart`。 */
export function parseBackfillArgs(args: readonly string[]): Pick<BackfillOptions, "maxBatches" | "restart"> {
  const out: Pick<BackfillOptions, "maxBatches" | "restart"> = {};
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

/** 往回 N 年的 UTC 午夜。 */
export function lookbackFrom(startedAt: Date, years: number): Date {
  return new Date(Date.UTC(startedAt.getUTCFullYear() - years, startedAt.getUTCMonth(), startedAt.getUTCDate()));
}

export function parseCursor(raw: string | null | undefined): BackfillCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<BackfillCursor>;
    if (c.tier !== 1 || !["recent", "undated", "done"].includes(c.phase ?? "")) return null;
    if (typeof c.afterId !== "number" || typeof c.firstReleaseFrom !== "string") return null;
    return c as BackfillCursor;
  } catch {
    return null;
  }
}

function phaseQuery(c: BackfillCursor): Omit<FetchGamesQuery, "limit" | "afterId"> {
  return c.phase === "recent"
    ? { firstReleaseFrom: new Date(c.firstReleaseFrom), gameTypes: WHITELIST_GAME_TYPES }
    : { firstReleaseMissingWithDates: true, gameTypes: WHITELIST_GAME_TYPES };
}

/** 一頁不滿 → 這個階段結束，換下一階段從 id 0 開始。 */
export function advanceCursor(c: BackfillCursor, pageLength: number, lastId: number | undefined, pageSize: number): BackfillCursor {
  if (pageLength >= pageSize && lastId !== undefined) return { ...c, afterId: lastId };
  if (c.phase === "recent") return { ...c, phase: "undated", afterId: 0 };
  return { ...c, phase: "done", afterId: 0 };
}

function addStats(total: GameBatchStats, b: GameBatchStats): GameBatchStats {
  const out = { ...total };
  for (const k of Object.keys(b) as Array<keyof GameBatchStats>) {
    if (typeof b[k] === "number") (out[k] as number) = ((total[k] as number) ?? 0) + (b[k] as number);
  }
  out.failedIgdbIds = [...total.failedIgdbIds, ...b.failedIgdbIds].slice(-FAILED_IDS_KEEP);
  out.unknownPlatformIgdbIds = [...new Set([...total.unknownPlatformIgdbIds, ...b.unknownPlatformIgdbIds])].sort((x, y) => x - y);
  return out;
}

export interface BackfillResult {
  cursor: BackfillCursor;
  batches: number;
  /** 本次執行的統計。 */
  run: GameBatchStats;
  /** 這一輪回填（含之前中斷的部分）的累計。 */
  totals: GameBatchStats;
  stoppedEarly: boolean;
}

export async function backfillGames(
  provider: GameDataProvider,
  ctx: { startedAt: Date; log: Log },
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const state = await getSyncState(IGDB_BACKFILL_STATE);
  let cursor = opts.restart ? null : parseCursor(state?.cursor);
  let totals: GameBatchStats =
    cursor && state?.meta?.totals ? { ...emptyBatchStats(), ...(state.meta.totals as GameBatchStats) } : emptyBatchStats();

  if (!cursor) {
    cursor = {
      tier: 1,
      phase: "recent",
      afterId: 0,
      firstReleaseFrom: lookbackFrom(ctx.startedAt, opts.lookbackYears).toISOString(),
      startedAt: ctx.startedAt.toISOString(),
    };
    ctx.log("Tier 1 回填開始", { firstReleaseFrom: cursor.firstReleaseFrom, gameTypes: WHITELIST_GAME_TYPES });
  } else if (cursor.phase === "done") {
    ctx.log("Tier 1 回填已完成；要重跑請加 --restart", { cursor });
    return { cursor, batches: 0, run: emptyBatchStats(), totals, stoppedEarly: false };
  } else {
    ctx.log("從中斷處續傳", { cursor });
  }

  const wctx = { ...(await loadWriteContext(ctx.startedAt, ctx.log)), markMissingRemoved: false };
  let run = emptyBatchStats();
  let batches = 0;
  let stoppedEarly = false;

  const fetchPage = (c: BackfillCursor) => provider.fetchGames({ ...phaseQuery(c), afterId: c.afterId, limit: pageSize });
  const canRun = (n: number) => opts.maxBatches === undefined || n < opts.maxBatches;

  // 預先抓下一頁：寫入這一批的同時請求下一頁（IGDB 單頁可能要十幾秒）。cursor 仍在寫完後才推進。
  let pending: Promise<Awaited<ReturnType<typeof fetchPage>>> | null = canRun(0) ? fetchPage(cursor) : null;
  while (cursor.phase !== "done") {
    if (!pending) {
      stoppedEarly = true;
      break;
    }
    const page = await pending;
    const next = advanceCursor(cursor, page.length, page[page.length - 1]?.igdbId, pageSize);
    pending = next.phase !== "done" && canRun(batches + 1) ? fetchPage(next) : null;
    pending?.catch(() => undefined); // 寫入失敗提早離開時，避免未處理的 rejection；真正的錯誤在下一輪 await 時拋出

    const batch = emptyBatchStats();
    await writeGameBatch(page, wctx, batch);
    run = addStats(run, batch);
    totals = addStats(totals, batch);

    const phaseBefore = cursor.phase;
    cursor = next;
    batches += 1;
    // 這一批的每款都寫完（或記為失敗）才推進 cursor；中斷時重做這一批是冪等的
    await saveSyncProgress(IGDB_BACKFILL_STATE, {
      cursor: JSON.stringify(cursor),
      meta: { tier: 1, totals, lastBatchAt: new Date().toISOString() },
      ...(cursor.phase === "done" ? { lastSyncedAt: ctx.startedAt } : {}),
    });
    ctx.log("回填一批完成", {
      phase: phaseBefore,
      fetched: batch.fetched,
      inserted: batch.inserted,
      updated: batch.updated,
      failed: batch.failed,
      next: cursor,
      totalFetched: totals.fetched,
    });
  }

  if (stoppedEarly) ctx.log("已達 --max-batches，停止；下次執行會續傳", { cursor });
  else ctx.log("Tier 1 回填完成", { ...totals });
  if (totals.unknownPlatformIgdbIds.length > 0) {
    ctx.log("上市日指向未知平台，已略過（sync_platforms 是否最新？）", { igdbPlatformIds: totals.unknownPlatformIgdbIds });
  }
  if (run.failed > 0) {
    throw new Error(`backfill_games：本次 ${run.failed} 款寫入失敗（id 見 sync_state.meta.totals.failedIgdbIds），cursor 已推進`);
  }
  return { cursor, batches, run, totals, stoppedEarly };
}
