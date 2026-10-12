import cron, { type ScheduledTask } from "node-cron";
import { withSessionLock, withXactLock } from "../db/locks";
import { recordJobFailure, recordJobSuccess } from "../db/sync-state";
import type { JobContext, ModuleManifestBase, ScheduledJob } from "../modules/types";

export type JobOutcome = "succeeded" | "failed" | "skipped";

function makeContext(job: ScheduledJob, startedAt: Date): JobContext {
  return {
    startedAt,
    log: (message, extra) => console.log(`[job:${job.name}] ${message}`, extra ?? ""),
  };
}

/**
 * 以 advisory lock 包住並執行一次任務（02 §排程）。
 * - 拿不到鎖（上一輪未結束或另一實例在跑）→ 安靜跳過。
 * - 結果寫入 sync_state 心跳；任務本身不處理鎖。
 */
export async function runJobOnce(job: ScheduledJob): Promise<JobOutcome> {
  const startedAt = new Date();
  const lock = job.lockMode === "session" ? withSessionLock : withXactLock;
  try {
    const ran = await lock(job.name, () => job.run(makeContext(job, startedAt)));
    if (!ran) return "skipped";
    await recordJobSuccess(job.name);
    return "succeeded";
  } catch (err) {
    console.error(`[job:${job.name}] 失敗`, err);
    await recordJobFailure(job.name, err).catch((e) => console.error(`[job:${job.name}] 寫入心跳失敗`, e));
    return "failed";
  }
}

const g = globalThis as typeof globalThis & { __sokScheduler?: ScheduledTask[] };

/** 收集已啟用模組的任務並註冊；重複呼叫（HMR）不會重複註冊。 */
export function startScheduler(enabled: readonly ModuleManifestBase[]): ScheduledJob[] {
  if (g.__sokScheduler) return [];
  const jobs = enabled.flatMap((m) => m.jobs ?? []);
  for (const job of jobs) {
    if (!cron.validate(job.cron)) throw new Error(`任務 ${job.name} 的 cron 無效：${job.cron}`);
  }
  g.__sokScheduler = jobs.map((job) =>
    cron.schedule(job.cron, () => {
      void runJobOnce(job);
    }, { name: job.name, noOverlap: true }),
  );
  console.log(`[kernel] 排程已註冊 ${jobs.length} 個任務${jobs.length ? `：${jobs.map((j) => j.name).join(", ")}` : ""}`);
  return jobs;
}

export function stopScheduler(): void {
  for (const t of g.__sokScheduler ?? []) void t.stop();
  g.__sokScheduler = undefined;
}
