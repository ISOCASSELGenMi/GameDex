import { getCoreEnv } from "@/kernel/config/env";
import { describeModules, validateModules } from "@/kernel/modules/startup";
import { startScheduler } from "@/kernel/scheduler";
import { enabledModules } from "@/modules/registry";

/**
 * 啟動檢查與排程註冊。任何設定問題都丟例外 → 伺服器拒絕啟動（fail closed）。
 * next build 階段不會呼叫 register()，所以 CI 的 build 不需要資料庫。
 */
export async function bootstrap(): Promise<void> {
  const env = getCoreEnv();
  const modules = enabledModules();
  validateModules(modules);
  console.log(describeModules(modules));
  if (env.SCHEDULER_ENABLED) {
    startScheduler(modules);
  } else {
    console.log("[kernel] SCHEDULER_ENABLED=false，未註冊排程");
  }
}
