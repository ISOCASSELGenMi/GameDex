/**
 * backfill_company_positions（D88）：為既有的 game_companies 補 igdb_position（公司在 IGDB involved_companies 的位置），
 * 並重算 games.publisher_group——廠商分欄「同一角色取 IGDB 列出的第一個」需要這個順序，舊資料沒存。
 * 依 games.igdb_id 升冪、每批 500 款，以 IGDB `where id = (...)` 只取公司欄位（fieldSet "companies"）；
 * 一批一個 transaction（位置更新＋分組重算，repository/game-groups.ts applyCompanyPositionsBatch），不寫 change_feed、不動其他欄位。
 * 進度存 sync_state（jobName='igdb_backfill_company_positions'）的 cursor（JSON），每批寫完才推進 → 可續跑。
 * 需要 IGDB 金鑰（IGDB_CLIENT_ID／IGDB_CLIENT_SECRET）。新同步（syncIgdbGame）已會寫順序，這個任務只需對 migration 0017 之前的資料跑一次。
 * 手動執行：npm run job -- backfill_company_positions [--max-batches N] [--restart]
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { applyCompanyPositionsBatch, type CompanyPositionEntry } from "../../repository/game-groups";
import { listGameIgdbIdsAfter } from "../../repository/game-sync";
import { GAMES_PAGE_SIZE } from "./sync-games";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_BACKFILL_COMPANY_POSITIONS_STATE = "igdb_backfill_company_positions";

export interface CompanyPositionsCursor {
  /** 已處理到的 games.igdb_id。 */
  afterId: number;
  done: boolean;
  startedAt: string;
}

export interface CompanyPositionsOptions {
  maxBatches?: number;
  restart?: boolean;
  pageSize?: number;
}

export interface CompanyPositionsTotals {
  /** 向 IGDB 要的遊戲數。 */
  requested: number;
  /** IGDB 實際回傳的遊戲數（少於 requested＝IGDB 已刪除或隱藏）。 */
  fetched: number;
  positionsUpdated: number;
  groupsUpdated: number;
}

const emptyTotals = (): CompanyPositionsTotals => ({ requested: 0, fetched: 0, positionsUpdated: 0, groupsUpdated: 0 });

/** 解析 `npm run job -- backfill_company_positions --max-batches 3 --restart`。 */
export function parseCompanyPositionsArgs(args: readonly string[]): Pick<CompanyPositionsOptions, "maxBatches" | "restart"> {
  const out: Pick<CompanyPositionsOptions, "maxBatches" | "restart"> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
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

export function parseCompanyPositionsCursor(raw: string | null | undefined): CompanyPositionsCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<CompanyPositionsCursor>;
    if (typeof c.afterId !== "number" || typeof c.done !== "boolean") return null;
    return c as CompanyPositionsCursor;
  } catch {
    return null;
  }
}

export interface CompanyPositionsResult {
  cursor: CompanyPositionsCursor;
  batches: number;
  run: CompanyPositionsTotals;
  totals: CompanyPositionsTotals;
  stoppedEarly: boolean;
}

const add = (a: CompanyPositionsTotals, b: CompanyPositionsTotals): CompanyPositionsTotals => ({
  requested: a.requested + b.requested,
  fetched: a.fetched + b.fetched,
  positionsUpdated: a.positionsUpdated + b.positionsUpdated,
  groupsUpdated: a.groupsUpdated + b.groupsUpdated,
});

export async function backfillCompanyPositions(
  provider: GameDataProvider,
  ctx: { startedAt: Date; log: Log },
  opts: CompanyPositionsOptions = {},
): Promise<CompanyPositionsResult> {
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const state = await getSyncState(IGDB_BACKFILL_COMPANY_POSITIONS_STATE);
  let cursor = opts.restart ? null : parseCompanyPositionsCursor(state?.cursor);
  let totals: CompanyPositionsTotals =
    cursor && state?.meta?.totals ? { ...emptyTotals(), ...(state.meta.totals as CompanyPositionsTotals) } : emptyTotals();

  if (!cursor) {
    cursor = { afterId: 0, done: false, startedAt: ctx.startedAt.toISOString() };
    totals = emptyTotals();
    ctx.log("公司順序回填開始");
  } else if (cursor.done) {
    ctx.log("公司順序回填已完成；要重跑請加 --restart", { cursor });
    return { cursor, batches: 0, run: emptyTotals(), totals, stoppedEarly: false };
  } else {
    ctx.log("從中斷處續傳", { cursor });
  }

  let run = emptyTotals();
  let batches = 0;
  let stoppedEarly = false;

  while (!cursor.done) {
    if (opts.maxBatches !== undefined && batches >= opts.maxBatches) {
      stoppedEarly = true;
      break;
    }
    const igdbIds = await listGameIgdbIdsAfter(cursor.afterId, pageSize);
    const batch = emptyTotals();
    if (igdbIds.length > 0) {
      const page = await provider.fetchGames({ ids: igdbIds, fieldSet: "companies", limit: pageSize });
      const entries: CompanyPositionEntry[] = page.flatMap((g) =>
        g.companies.map((c) => ({ igdbGameId: g.igdbId, igdbCompanyId: c.company.igdbId, position: c.position })),
      );
      const written = await applyCompanyPositionsBatch(entries, igdbIds);
      batch.requested = igdbIds.length;
      batch.fetched = page.length;
      batch.positionsUpdated = written.positionsUpdated;
      batch.groupsUpdated = written.groupsUpdated;
    }
    run = add(run, batch);
    totals = add(totals, batch);
    batches += 1;
    // 寫完才推進；中斷時重做這一批是冪等的
    cursor = {
      ...cursor,
      afterId: igdbIds.length > 0 ? igdbIds[igdbIds.length - 1]! : cursor.afterId,
      done: igdbIds.length < pageSize,
    };
    await saveSyncProgress(IGDB_BACKFILL_COMPANY_POSITIONS_STATE, {
      cursor: JSON.stringify(cursor),
      meta: { totals, lastBatchAt: new Date().toISOString() },
      ...(cursor.done ? { lastSyncedAt: ctx.startedAt } : {}),
    });
    ctx.log("公司順序回填一批完成", { ...batch, next: cursor });
  }

  if (stoppedEarly) ctx.log("已達 --max-batches，停止；下次執行會續傳", { cursor });
  else ctx.log("公司順序回填完成", { ...totals });
  return { cursor, batches, run, totals, stoppedEarly };
}
