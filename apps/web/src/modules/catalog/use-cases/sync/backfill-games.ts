/**
 * backfill_games（04 §回填）：手動執行的長任務（session lock）。
 * Tier 1（預設）：
 *   (a) recent：first_release_date >= 開始時往回 BACKFILL_LOOKBACK_YEARS 年，限白名單類型
 *   (b) undated：first_release_date = null & release_dates != null，限白名單類型（D62：沒有上市日的留給 Tier 2）
 * Tier 2（--tier 2）：
 *   all：歷史全量，限白名單類型（id 升冪）
 * 進度存 sync_state 的 cursor（JSON；Tier 1 jobName='igdb_backfill'、Tier 2 'igdb_backfill_tier2'），
 * 每批寫完才更新 → 中斷後從下一批續傳。
 * 回填只 upsert、不標 removed；寫入與增量同步共用 writeGameBatch。
 * 每批寫完只解析這批的相似清單，整輪完成再跑一次全量 resolve_relations（04 §排程任務）。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import { WHITELIST_GAME_TYPES, type FetchGamesQuery } from "../../domain/entities";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { resolveBatchRelations, resolveRelations } from "./resolve-relations";
import { emptyBatchStats, GAMES_PAGE_SIZE, loadWriteContext, writeGameBatch, type GameBatchStats } from "./sync-games";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_BACKFILL_STATE = "igdb_backfill";
export const IGDB_BACKFILL_TIER2_STATE = "igdb_backfill_tier2";
/** meta 裡最多保留幾個失敗 id。 */
const FAILED_IDS_KEEP = 500;

export type BackfillTier = 1 | 2;
export type BackfillPhase = "recent" | "undated" | "all" | "done";

const TIER_PHASES: Record<BackfillTier, readonly BackfillPhase[]> = {
  1: ["recent", "undated", "done"],
  2: ["all", "done"],
};

export function backfillStateName(tier: BackfillTier): string {
  return tier === 1 ? IGDB_BACKFILL_STATE : IGDB_BACKFILL_TIER2_STATE;
}

export interface BackfillCursor {
  tier: BackfillTier;
  phase: BackfillPhase;
  /** 目前階段已處理到的 igdbId（id 升冪）。 */
  afterId: number;
  /** Tier 1 (a) 的下限，第一次開始時固定，續傳沿用；Tier 2 沒有。 */
  firstReleaseFrom?: string;
  startedAt: string;
}

export interface BackfillOptions {
  lookbackYears: number;
  /** 預設 1。 */
  tier?: BackfillTier;
  /** 本次最多處理幾批（測試、分段執行用）；未給＝做到完。 */
  maxBatches?: number;
  /** 丟掉既有進度，從頭開始。 */
  restart?: boolean;
  pageSize?: number;
}

type ParsedArgs = Pick<BackfillOptions, "maxBatches" | "restart" | "tier">;

/** 解析 `npm run job -- backfill_games --tier 2 --max-batches 3 --restart`。 */
export function parseBackfillArgs(args: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => (a.includes("=") ? a.split("=")[1] : args[++i]);
    if (a === "--restart") out.restart = true;
    else if (a === "--max-batches" || a.startsWith("--max-batches=")) {
      const raw = value();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--max-batches 需要正整數：${raw ?? ""}`);
      out.maxBatches = n;
    } else if (a === "--tier" || a.startsWith("--tier=")) {
      const raw = value();
      if (raw !== "1" && raw !== "2") throw new Error(`--tier 只能是 1 或 2：${raw ?? ""}`);
      out.tier = Number(raw) as BackfillTier;
    } else throw new Error(`未知的參數：${a}（可用：--tier 1|2、--max-batches N、--restart）`);
  }
  return out;
}

/** 往回 N 年的 UTC 午夜。 */
export function lookbackFrom(startedAt: Date, years: number): Date {
  return new Date(Date.UTC(startedAt.getUTCFullYear() - years, startedAt.getUTCMonth(), startedAt.getUTCDate()));
}

/** 解析並驗證 cursor；tier 不符或格式錯 → null（視為沒有進度）。 */
export function parseCursor(raw: string | null | undefined, tier: BackfillTier = 1): BackfillCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<BackfillCursor>;
    if (c.tier !== tier || !TIER_PHASES[tier].includes(c.phase as BackfillPhase)) return null;
    if (typeof c.afterId !== "number") return null;
    if (tier === 1 && typeof c.firstReleaseFrom !== "string") return null;
    return c as BackfillCursor;
  } catch {
    return null;
  }
}

function phaseQuery(c: BackfillCursor): Omit<FetchGamesQuery, "limit" | "afterId"> {
  switch (c.phase) {
    case "recent":
      return { firstReleaseFrom: new Date(c.firstReleaseFrom!), gameTypes: WHITELIST_GAME_TYPES };
    case "undated":
      return { firstReleaseMissingWithDates: true, gameTypes: WHITELIST_GAME_TYPES };
    default:
      return { gameTypes: WHITELIST_GAME_TYPES };
  }
}

/** 一頁不滿 → 這個階段結束，換下一階段從 id 0 開始。 */
export function advanceCursor(c: BackfillCursor, pageLength: number, lastId: number | undefined, pageSize: number): BackfillCursor {
  if (pageLength >= pageSize && lastId !== undefined) return { ...c, afterId: lastId };
  const phases = TIER_PHASES[c.tier];
  return { ...c, phase: phases[phases.indexOf(c.phase) + 1] ?? "done", afterId: 0 };
}

function initialCursor(tier: BackfillTier, startedAt: Date, lookbackYears: number): BackfillCursor {
  const base = { tier, phase: TIER_PHASES[tier][0], afterId: 0, startedAt: startedAt.toISOString() };
  return tier === 1 ? { ...base, firstReleaseFrom: lookbackFrom(startedAt, lookbackYears).toISOString() } : base;
}

export function addStats(total: GameBatchStats, b: GameBatchStats): GameBatchStats {
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
  const tier = opts.tier ?? 1;
  const stateName = backfillStateName(tier);
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const state = await getSyncState(stateName);
  let cursor = opts.restart ? null : parseCursor(state?.cursor, tier);
  let totals: GameBatchStats =
    cursor && state?.meta?.totals ? { ...emptyBatchStats(), ...(state.meta.totals as GameBatchStats) } : emptyBatchStats();

  if (!cursor) {
    cursor = initialCursor(tier, ctx.startedAt, opts.lookbackYears);
    ctx.log(`Tier ${tier} 回填開始`, { firstReleaseFrom: cursor.firstReleaseFrom, gameTypes: WHITELIST_GAME_TYPES });
  } else if (cursor.phase === "done") {
    ctx.log(`Tier ${tier} 回填已完成；要重跑請加 --restart`, { cursor });
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
    const similar = await resolveBatchRelations(page.map((r) => r.igdbId));
    run = addStats(run, batch);
    totals = addStats(totals, batch);

    const phaseBefore = cursor.phase;
    cursor = next;
    batches += 1;
    // 這一批的每款都寫完（或記為失敗）才推進 cursor；中斷時重做這一批是冪等的
    await saveSyncProgress(stateName, {
      cursor: JSON.stringify(cursor),
      meta: { tier, totals, lastBatchAt: new Date().toISOString() },
      ...(cursor.phase === "done" ? { lastSyncedAt: ctx.startedAt } : {}),
    });
    ctx.log("回填一批完成", {
      phase: phaseBefore,
      fetched: batch.fetched,
      inserted: batch.inserted,
      updated: batch.updated,
      failed: batch.failed,
      similarInserted: similar.inserted,
      next: cursor,
      totalFetched: totals.fetched,
    });
  }

  if (stoppedEarly) ctx.log("已達 --max-batches，停止；下次執行會續傳", { cursor });
  else {
    ctx.log(`Tier ${tier} 回填完成`, { ...totals });
    // 局部解析補不到「別的遊戲指向這批」的配對，整輪結束跑一次全量
    await resolveRelations(ctx);
  }
  if (totals.unknownPlatformIgdbIds.length > 0) {
    ctx.log("上市日指向未知平台，已略過（sync_platforms 是否最新？）", { igdbPlatformIds: totals.unknownPlatformIgdbIds });
  }
  if (run.failed > 0) {
    throw new Error(
      `backfill_games：本次 ${run.failed} 款寫入失敗（id 見 sync_state[${stateName}].meta.totals.failedIgdbIds），cursor 已推進`,
    );
  }
  return { cursor, batches, run, totals, stoppedEarly };
}
