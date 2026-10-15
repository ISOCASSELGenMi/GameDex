/**
 * 任務心跳告警（16 §Uptime 與告警）：`now − lastSuccessAt > 2 × 預期間隔` 或連續失敗 ≥ 3 次 → 打 `ALERT_WEBHOOK_URL`。
 *
 * - 預期間隔由 manifest 的 cron 推算（cron-interval.ts）；沒有 cron 的任務（手動執行）不監控。
 * - 沒有狀態列的任務（從沒跑過）不告警；有失敗紀錄但從沒成功過的任務只依「連續失敗」判斷。
 * - 去重：同一個任務在 ALERT_DEDUPE_MS（6 小時）內最多告警一次，記在 sync_state.last_alerted_at（多實例共用）；
 *   任務下次成功時清除，所以復發會立刻再告警。
 * - 未設 ALERT_WEBHOOK_URL：只寫 log。告警訊息裡的錯誤文字會先過 scrubString。
 * kernel 層任務，每 10 分鐘（HEARTBEAT_CRON）；由 startScheduler 自動加入，不屬於任何模組。
 */
import { sendAlertWebhook } from "../alerts/webhook";
import { getCoreEnv } from "../config/env";
import { listSyncStates, markJobsAlerted, type SyncStateRow } from "../db/sync-state";
import type { ScheduledJob } from "../modules/types";
import { scrubString } from "../observability/scrub";
import { cronMaxIntervalMs } from "./cron-interval";

export const HEARTBEAT_JOB_NAME = "kernel_heartbeat_check";
export const HEARTBEAT_CRON = "*/10 * * * *";
/** 逾期倍數：超過 2 × 預期間隔沒成功就告警。 */
export const OVERDUE_FACTOR = 2;
/** 連續失敗幾次告警。 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;
/** 同一任務兩次告警的最短間隔。 */
export const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000;

export type HeartbeatProblem =
  | { kind: "overdue"; job: string; lastSuccessAt: Date; intervalMs: number; ageMs: number }
  | { kind: "failing"; job: string; consecutiveFailures: number; lastError: string | null };

export interface MonitoredJob {
  name: string;
  cron: string;
}

/** 純函式：哪些任務有問題（尚未套用去重）。 */
export function findHeartbeatProblems(jobs: readonly MonitoredJob[], rows: readonly SyncStateRow[], now: Date): HeartbeatProblem[] {
  const byName = new Map(rows.map((r) => [r.jobName, r]));
  const problems: HeartbeatProblem[] = [];
  for (const job of jobs) {
    const row = byName.get(job.name);
    if (!row) continue;
    if (row.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      problems.push({ kind: "failing", job: job.name, consecutiveFailures: row.consecutiveFailures, lastError: row.lastError });
      continue;
    }
    const intervalMs = cronMaxIntervalMs(job.cron);
    if (intervalMs === null || !row.lastSuccessAt) continue;
    const ageMs = now.getTime() - row.lastSuccessAt.getTime();
    if (ageMs > OVERDUE_FACTOR * intervalMs) {
      problems.push({ kind: "overdue", job: job.name, lastSuccessAt: row.lastSuccessAt, intervalMs, ageMs });
    }
  }
  return problems;
}

/** 純函式：去重（lastAlertedAt 在去重視窗內的略過）。 */
export function dropRecentlyAlerted(problems: readonly HeartbeatProblem[], rows: readonly SyncStateRow[], now: Date): HeartbeatProblem[] {
  const byName = new Map(rows.map((r) => [r.jobName, r]));
  return problems.filter((p) => {
    const at = byName.get(p.job)?.lastAlertedAt;
    return !at || now.getTime() - at.getTime() >= ALERT_DEDUPE_MS;
  });
}

function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 10 ? String(Math.round(h)) : h.toFixed(1);
}

export function formatHeartbeatAlert(problems: readonly HeartbeatProblem[]): string {
  const lines = problems.map((p) =>
    p.kind === "overdue"
      ? `- ${p.job}：已 ${hours(p.ageMs)} 小時沒有成功執行（預期每 ${hours(p.intervalMs)} 小時，超過 ${OVERDUE_FACTOR} 倍）`
      : `- ${p.job}：連續失敗 ${p.consecutiveFailures} 次${p.lastError ? `，最近一次：${scrubString(p.lastError).slice(0, 200)}` : ""}`,
  );
  return `[SoK] 排程任務異常（${problems.length}）\n${lines.join("\n")}`;
}

export interface HeartbeatDeps {
  now?: () => Date;
  listStates?: (names: readonly string[]) => Promise<SyncStateRow[]>;
  markAlerted?: (names: readonly string[], at: Date) => Promise<void>;
  /** 回傳是否送達；測試用。 */
  alert?: (url: string, message: string) => Promise<boolean>;
  /** 明確傳入（含 undefined＝未設）時不讀環境變數；測試用。 */
  webhookUrl?: string | undefined;
  log?: (message: string) => void;
}

export interface HeartbeatResult {
  problems: HeartbeatProblem[];
  alerted: string[];
  webhook: "sent" | "failed" | "not_configured" | "nothing_to_report";
}

/** 檢查一次並視需要告警。 */
export async function checkHeartbeats(jobs: readonly MonitoredJob[], deps: HeartbeatDeps = {}): Promise<HeartbeatResult> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? ((m: string) => console.warn(m));
  const rows = await (deps.listStates ?? listSyncStates)(jobs.map((j) => j.name));
  const problems = findHeartbeatProblems(jobs, rows, now);
  const fresh = dropRecentlyAlerted(problems, rows, now);
  if (fresh.length === 0) return { problems, alerted: [], webhook: "nothing_to_report" };

  const message = formatHeartbeatAlert(fresh);
  const url = "webhookUrl" in deps ? deps.webhookUrl : getCoreEnv().ALERT_WEBHOOK_URL;
  const names = fresh.map((p) => p.job);
  if (!url) {
    // 沒設通道：只 log；不寫 lastAlertedAt（設好通道後下一輪就會送）
    log(`[heartbeat] ${message}`);
    return { problems, alerted: [], webhook: "not_configured" };
  }
  const ok = await (deps.alert ?? sendAlertWebhook)(url, message);
  if (!ok) {
    log(`[heartbeat] 告警送出失敗，下一輪重試：${names.join(", ")}`);
    return { problems, alerted: [], webhook: "failed" };
  }
  await (deps.markAlerted ?? markJobsAlerted)(names, now);
  return { problems, alerted: names, webhook: "sent" };
}

/** kernel 的心跳任務；monitored 是已啟用模組的排程任務（有 cron 的）。 */
export function createHeartbeatJob(monitored: readonly MonitoredJob[]): ScheduledJob & { cron: string } {
  return {
    name: HEARTBEAT_JOB_NAME,
    cron: HEARTBEAT_CRON,
    async run(ctx) {
      const res = await checkHeartbeats(monitored);
      if (res.problems.length > 0) ctx.log(`異常任務 ${res.problems.map((p) => p.job).join(", ")}；告警：${res.webhook}`);
    },
  };
}
