/**
 * refresh_popularity（03 §熱度、04 §排程）：每小時執行一次。
 * - 每次：upcoming 群（未上市或上市 ≤ 30 天）重算結構訊號與分數。
 * - 距離上次「全量」超過 23 小時（或手動 `--scope all`）：兩群都算（released 群每日一次）。
 * - IGDB 原始訊號（popularity_primitives）每種類整批重算、約每日一次：先用 2 個請求查 calculated_at，
 *   有變（或從未抓過）才全量重抓（約 211 個請求）並整份取代 igdb_hype。
 * - 已註冊的外部訊號（PopularitySignal，例如 accounts 的 site_follows）每次全量取代。
 * IGDB 失敗時仍用既有的 igdb_hype 算分數，最後再丟錯讓心跳記失敗（下一小時重試）。
 * 進度存 sync_state（jobName='igdb_popularity'）。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import {
  EXTERNAL_HYPE_KINDS,
  POPULARITY_GROUPS,
  type ExternalHypeSource,
  type ExternalHypeVersion,
  type PopularityGroup,
  type PopularitySignal,
} from "../../domain/entities";
import { combineHypeRecords, resolveHeatWeights, type HeatWeights } from "../../domain/heat";
import {
  getPopularityContext,
  recomputePopularity,
  refreshStructuralSignal,
  replaceExternalSignal,
  replaceIgdbHypeSignal,
  type RecomputeStats,
  type SignalWriteStats,
} from "../../repository/popularity";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const POPULARITY_STATE = "igdb_popularity";
/** 距離上次全量超過這麼久就做全量（每小時排程下約每日一次，容許排程延遲）。 */
export const FULL_REFRESH_INTERVAL_MS = 23 * 60 * 60 * 1000;

export type PopularityScope = "auto" | "all" | "upcoming";

export interface RefreshPopularityOptions {
  scope?: PopularityScope;
  /** 已註冊的外部訊號（manifest 的 popularitySignals）；目前沒有。 */
  externalSignals?: readonly PopularitySignal[];
  /** HEAT_COLD_START_FOLLOWS。 */
  coldStartFollows: number;
  /** 忽略版本檢查，強制重抓 IGDB 全量。 */
  forceHypeFetch?: boolean;
}

export interface RefreshPopularityResult {
  groups: PopularityGroup[];
  hype: { fetched: boolean; records: number; games: number; write: SignalWriteStats | null; error: string | null };
  external: Array<{ name: string; write: SignalWriteStats }>;
  structural: Partial<Record<PopularityGroup, { upserted: number; deleted: number }>>;
  scores: Partial<Record<PopularityGroup, RecomputeStats & { weights: HeatWeights }>>;
}

interface PopularityMeta {
  lastFullAt?: string;
  hypeVersion?: ExternalHypeVersion;
}

/** `--scope all|upcoming`、`--force-hype`（npm run job -- refresh_popularity ...）。 */
export function parseRefreshPopularityArgs(args: readonly string[]): Pick<RefreshPopularityOptions, "scope" | "forceHypeFetch"> {
  const out: Pick<RefreshPopularityOptions, "scope" | "forceHypeFetch"> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope") {
      const v = args[++i];
      if (v !== "all" && v !== "upcoming" && v !== "auto") throw new Error(`--scope 只接受 all、upcoming、auto：${v}`);
      out.scope = v;
    } else if (args[i] === "--force-hype") out.forceHypeFetch = true;
    else throw new Error(`refresh_popularity 不認得的參數：${args[i]}`);
  }
  return out;
}

/** 依上次全量時間決定這次算哪幾群。 */
export function resolvePopularityGroups(scope: PopularityScope, lastFullAt: string | undefined, now: Date): PopularityGroup[] {
  if (scope === "all") return [...POPULARITY_GROUPS];
  if (scope === "upcoming") return ["upcoming"];
  const last = lastFullAt ? Date.parse(lastFullAt) : NaN;
  return !Number.isFinite(last) || now.getTime() - last >= FULL_REFRESH_INTERVAL_MS ? [...POPULARITY_GROUPS] : ["upcoming"];
}

/** 從未抓過、或任一種類的版本不同 → 要重抓。 */
export function hypeVersionChanged(prev: ExternalHypeVersion | undefined, next: ExternalHypeVersion): boolean {
  if (!prev) return true;
  return EXTERNAL_HYPE_KINDS.some((k) => (prev[k] ?? null) !== (next[k] ?? null));
}

export async function refreshPopularity(
  source: ExternalHypeSource,
  ctx: { startedAt: Date; log: Log },
  opts: RefreshPopularityOptions,
): Promise<RefreshPopularityResult> {
  const state = await getSyncState(POPULARITY_STATE);
  const meta = (state?.meta ?? {}) as PopularityMeta;
  const todayUtc = ctx.startedAt.toISOString().slice(0, 10);
  const groups = resolvePopularityGroups(opts.scope ?? "auto", meta.lastFullAt, ctx.startedAt);

  const result: RefreshPopularityResult = {
    groups,
    hype: { fetched: false, records: 0, games: 0, write: null, error: null },
    external: [],
    structural: {},
    scores: {},
  };

  // 1. IGDB 原始訊號（版本有變才重抓）
  let hypeVersion = meta.hypeVersion;
  try {
    const version = await source.fetchHypeVersion();
    if (opts.forceHypeFetch || hypeVersionChanged(meta.hypeVersion, version)) {
      const records = await source.fetchHypeRecords();
      result.hype.fetched = true;
      result.hype.records = records.length;
      if (records.length === 0) {
        // 來源回空：不清空既有訊號（可能是來源暫時異常），也不推進版本
        result.hype.error = "IGDB popularity_primitives 回傳 0 筆，保留既有 igdb_hype";
      } else {
        const combined = combineHypeRecords(records);
        result.hype.games = combined.size;
        result.hype.write = await replaceIgdbHypeSignal(combined);
        hypeVersion = version;
      }
    }
  } catch (err) {
    result.hype.error = err instanceof Error ? err.message : String(err);
  }
  if (result.hype.error) ctx.log("IGDB 熱度訊號未更新，沿用既有值", { error: result.hype.error });

  // 2. 外部擴充點訊號（全量取代）
  for (const signal of opts.externalSignals ?? []) {
    const rows = await signal.fetch({});
    result.external.push({ name: signal.name, write: await replaceExternalSignal(signal.name, rows) });
  }

  // 3~4. 結構訊號與分數（各群獨立）
  for (const group of groups) {
    result.structural[group] = await refreshStructuralSignal({ group, todayUtc });
    const c = await getPopularityContext({ group, todayUtc });
    const weights = resolveHeatWeights({ ...c, coldStartFollows: opts.coldStartFollows });
    result.scores[group] = { ...(await recomputePopularity({ group, todayUtc, weights })), weights };
  }

  ctx.log("熱度更新完成", { ...result });
  await saveSyncProgress(POPULARITY_STATE, {
    lastSyncedAt: ctx.startedAt,
    meta: {
      ...meta,
      ...(groups.length === POPULARITY_GROUPS.length ? { lastFullAt: ctx.startedAt.toISOString() } : {}),
      hypeVersion,
      lastResult: result,
    },
  });
  if (result.hype.error) throw new Error(`refresh_popularity：分數已用既有訊號更新，但 IGDB 訊號失敗：${result.hype.error}`);
  return result;
}
