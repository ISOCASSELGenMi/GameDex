import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/kernel/db/client";
import { withSessionLock, withXactLock } from "@/kernel/db/locks";
import { getSyncState } from "@/kernel/db/sync-state";
import { runJobOnce } from "@/kernel/scheduler";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("kernel 排程與 advisory lock（整合）", () => {
  afterAll(async () => {
    await closeDb();
  });

  for (const [label, lock] of [["xact", withXactLock], ["session", withSessionLock]] as const) {
    it(`${label} lock：同名任務並行時第二個安靜跳過，結束後可再取得`, async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = lock(`test_${label}`, () => gate);
      await new Promise((r) => setTimeout(r, 100));
      const second = await lock(`test_${label}`, async () => undefined);
      expect(second).toBe(false);
      release();
      expect(await first).toBe(true);
      expect(await lock(`test_${label}`, async () => undefined)).toBe(true);
    });
  }

  it("runJobOnce：成功寫 lastSuccessAt；失敗寫 lastFailureAt 與 lastError", async () => {
    const ok = await runJobOnce({ name: "test_job_ok", cron: "0 * * * *", run: async () => undefined });
    expect(ok).toBe("succeeded");
    expect((await getSyncState("test_job_ok"))?.lastSuccessAt).toBeInstanceOf(Date);

    const failed = await runJobOnce({
      name: "test_job_fail",
      cron: "0 * * * *",
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(failed).toBe("failed");
    const st = await getSyncState("test_job_fail");
    expect(st?.lastFailureAt).toBeInstanceOf(Date);
    expect(st?.lastError).toContain("boom");
  });
});
