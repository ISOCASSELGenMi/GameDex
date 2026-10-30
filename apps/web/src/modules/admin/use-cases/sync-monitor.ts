/**
 * /internal/sync 的 Use Case（12 §同步監控）：把 sync_state（任務心跳、回填進度）與已註冊的排程任務合併成唯讀的畫面資料。
 * 只用已有的資料來源：sync_state 的 lastSuccessAt／lastFailureAt／lastError／consecutiveFailures／cursor／meta。
 * 沒有 `rolling_refresh_misses` 這張表（spec 12 列的項目尚未建立），所以不顯示。
 */
import { listAllSyncStates } from "@/kernel/db/sync-state";

export interface JobDefinitionInfo {
  name: string;
  cron?: string;
  lockMode?: string;
  module: string;
}

export type JobHealth = "ok" | "failing" | "never" | "manual";

export interface SyncMonitorRow {
  name: string;
  /** 已註冊的排程任務才有。 */
  definition: JobDefinitionInfo | null;
  health: JobHealth;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastSyncedAt: Date | null;
  /** 回填進度（cursor／meta 的摘要文字）；沒有則 null。 */
  progress: string | null;
}

export interface SyncMonitorView {
  rows: SyncMonitorRow[];
  /** 最近失敗（新到舊，最多 10 筆）。 */
  recentFailures: SyncMonitorRow[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function summarizeProgress(cursor: string | null, meta: Record<string, unknown> | null): string | null {
  const parts: string[] = [];
  if (cursor) parts.push(`cursor ${clip(cursor, 160)}`);
  if (meta && Object.keys(meta).length > 0) parts.push(`meta ${clip(JSON.stringify(meta), 240)}`);
  return parts.length > 0 ? parts.join("；") : null;
}

export function healthOf(def: JobDefinitionInfo | null, success: Date | null, failure: Date | null): JobHealth {
  if (!success && !failure) return def && !def.cron ? "manual" : "never";
  if (failure && (!success || failure.getTime() > success.getTime())) return "failing";
  return "ok";
}

/** 純函式：把狀態列與任務定義合併（供單元測試）。 */
export function buildSyncMonitorView(
  states: ReadonlyArray<{
    jobName: string;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    consecutiveFailures: number;
    lastError: string | null;
    lastSyncedAt: Date | null;
    cursor: string | null;
    meta: Record<string, unknown> | null;
  }>,
  jobs: readonly JobDefinitionInfo[],
): SyncMonitorView {
  const defs = new Map(jobs.map((j) => [j.name, j] as const));
  const rows: SyncMonitorRow[] = states.map((s) => {
    const def = defs.get(s.jobName) ?? null;
    return {
      name: s.jobName,
      definition: def,
      health: healthOf(def, s.lastSuccessAt, s.lastFailureAt),
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError ? clip(s.lastError, 400) : null,
      lastSyncedAt: s.lastSyncedAt,
      progress: summarizeProgress(s.cursor, s.meta),
    };
  });
  // 已註冊但還沒有狀態列的任務（從沒跑過）
  const seen = new Set(states.map((s) => s.jobName));
  for (const j of jobs) {
    if (seen.has(j.name)) continue;
    rows.push({
      name: j.name,
      definition: j,
      health: healthOf(j, null, null),
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastError: null,
      lastSyncedAt: null,
      progress: null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const recentFailures = rows
    .filter((r) => r.lastFailureAt !== null)
    .sort((a, b) => b.lastFailureAt!.getTime() - a.lastFailureAt!.getTime())
    .slice(0, 10);
  return { rows, recentFailures };
}

export async function loadSyncMonitor(jobs: readonly JobDefinitionInfo[]): Promise<SyncMonitorView> {
  return buildSyncMonitorView(await listAllSyncStates(), jobs);
}
