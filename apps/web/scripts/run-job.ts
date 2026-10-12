// 手動執行一次排程任務（與排程相同：advisory lock＋sync_state 心跳）：npm run job -- sync_platforms
import { closeDb } from "@/kernel/db/client";
import { validateModules } from "@/kernel/modules/startup";
import { runJobOnce } from "@/kernel/scheduler";
import { enabledModules } from "@/modules/registry";

async function main(): Promise<number> {
  const name = process.argv[2];
  const modules = enabledModules();
  const jobs = modules.flatMap((m) => m.jobs ?? []);
  const job = jobs.find((j) => j.name === name);
  if (!job) {
    console.error(`[run-job] 找不到任務「${name ?? ""}」。可用：${jobs.map((j) => j.name).join(", ") || "（無）"}`);
    return 1;
  }
  validateModules(modules);
  const started = Date.now();
  const outcome = await runJobOnce(job);
  console.log(`[run-job] ${job.name}：${outcome}（${((Date.now() - started) / 1000).toFixed(1)}s）`);
  return outcome === "failed" ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("[run-job] 失敗：", err);
    await closeDb();
    process.exit(1);
  });
