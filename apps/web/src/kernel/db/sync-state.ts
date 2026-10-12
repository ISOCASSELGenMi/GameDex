import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { syncState } from "./schema";

/** 任務心跳（16 §Uptime 與告警）：每次執行後寫 lastSuccessAt／lastFailureAt／lastError。 */
export async function recordJobSuccess(jobName: string, at: Date = new Date()): Promise<void> {
  await getDb()
    .insert(syncState)
    .values({ jobName, lastSuccessAt: at, lastError: null })
    .onConflictDoUpdate({
      target: syncState.jobName,
      set: { lastSuccessAt: at, lastError: null, updatedAt: sql`now()` },
    });
}

export async function recordJobFailure(jobName: string, error: unknown, at: Date = new Date()): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await getDb()
    .insert(syncState)
    .values({ jobName, lastFailureAt: at, lastError: message.slice(0, 4000) })
    .onConflictDoUpdate({
      target: syncState.jobName,
      set: { lastFailureAt: at, lastError: message.slice(0, 4000), updatedAt: sql`now()` },
    });
}

export type SyncStateRow = typeof syncState.$inferSelect;

export async function getSyncState(jobName: string): Promise<SyncStateRow | null> {
  const rows = await getDb().select().from(syncState).where(eq(syncState.jobName, jobName)).limit(1);
  return rows[0] ?? null;
}

/** 增量同步用：寫回「任務開始時間」與 cursor／meta（04）。 */
export async function saveSyncProgress(
  jobName: string,
  patch: { lastSyncedAt?: Date; cursor?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await getDb()
    .insert(syncState)
    .values({ jobName, ...patch })
    .onConflictDoUpdate({ target: syncState.jobName, set: { ...patch, updatedAt: sql`now()` } });
}
