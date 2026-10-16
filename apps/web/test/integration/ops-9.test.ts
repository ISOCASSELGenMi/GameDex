import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb, closeDb } from "@/kernel/db/client";
import { syncState } from "@/kernel/db/schema";
import { getSyncState, recordJobFailure, recordJobSuccess } from "@/kernel/db/sync-state";
import { runJobOnce } from "@/kernel/scheduler";
import { ALERT_DEDUPE_MS, checkHeartbeats } from "@/kernel/scheduler/heartbeat";

const enabled = !!process.env.TEST_DATABASE_URL;
const H = 3_600_000;

describe.skipIf(!enabled)("任務心跳（整合：sync_state 連續失敗與告警）", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("連續失敗次數累加、成功歸零並清除已告警時間", async () => {
    const name = "ops9_counter";
    await recordJobFailure(name, new Error("a"));
    await recordJobFailure(name, new Error("b"));
    await recordJobFailure(name, new Error("c"));
    expect((await getSyncState(name))?.consecutiveFailures).toBe(3);
    await getDb().update(syncState).set({ lastAlertedAt: new Date() }).where(eq(syncState.jobName, name));
    await recordJobSuccess(name);
    const st = await getSyncState(name);
    expect(st?.consecutiveFailures).toBe(0);
    expect(st?.lastAlertedAt).toBeNull();
    expect(st?.lastError).toBeNull();
  });

  it("runJobOnce 失敗 3 次 → checkHeartbeats 告警一次；之後 6 小時內去重；成功後復發立刻再告警", async () => {
    const job = {
      name: "ops9_flaky",
      cron: "10 * * * *",
      run: async () => {
        throw new Error("boom password=hunter2");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 3; i += 1) expect(await runJobOnce(job, [], { module: "catalog" })).toBe("failed");
    vi.restoreAllMocks();

    const alert = vi.fn<(url: string, message: string) => Promise<boolean>>(async () => true);
    const log = vi.fn();
    const monitored = [{ name: job.name, cron: job.cron }];
    const first = await checkHeartbeats(monitored, { webhookUrl: "https://hooks.example/x", alert, log });
    expect(first).toMatchObject({ webhook: "sent", alerted: ["ops9_flaky"] });
    const message = alert.mock.calls[0]![1];
    expect(message).toContain("連續失敗 3 次");
    expect(message).not.toContain("hunter2");

    // 去重
    const second = await checkHeartbeats(monitored, { webhookUrl: "https://hooks.example/x", alert, log });
    expect(second.webhook).toBe("nothing_to_report");
    expect(alert).toHaveBeenCalledTimes(1);

    // 超過去重視窗 → 再送
    const later = new Date(Date.now() + ALERT_DEDUPE_MS + 60_000);
    expect((await checkHeartbeats(monitored, { webhookUrl: "https://hooks.example/x", alert, log, now: () => later })).webhook).toBe("sent");
    expect(alert).toHaveBeenCalledTimes(2);

    // 成功 → 清除；再失敗 3 次 → 立刻再告警（不必等 6 小時）
    await recordJobSuccess(job.name);
    expect((await checkHeartbeats(monitored, { webhookUrl: "https://hooks.example/x", alert, log })).webhook).toBe("nothing_to_report");
    for (let i = 0; i < 3; i += 1) await recordJobFailure(job.name, new Error("again"));
    expect((await checkHeartbeats(monitored, { webhookUrl: "https://hooks.example/x", alert, log })).webhook).toBe("sent");
  });

  it("逾期：lastSuccessAt 太舊 → 告警；未設 webhook 只 log", async () => {
    const name = "ops9_stale";
    await recordJobSuccess(name, new Date(Date.now() - 5 * H));
    const log = vi.fn();
    const monitored = [{ name, cron: "10 * * * *" }];
    const res = await checkHeartbeats(monitored, { webhookUrl: undefined, log });
    expect(res).toMatchObject({ webhook: "not_configured", alerted: [] });
    expect(res.problems[0]).toMatchObject({ kind: "overdue", job: name });
    expect(log).toHaveBeenCalled();
    expect((await getSyncState(name))?.lastAlertedAt).toBeNull();
  });
});
