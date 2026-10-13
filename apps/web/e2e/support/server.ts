/**
 * test:a11y 的 Playwright webServer 指令（`tsx e2e/support/server.ts`，cwd = apps/web）：
 * 1. 重建測試資料庫並寫入 fixture（seed.ts）
 * 2. `next build`（輸出到 E2E_DIST_DIR，不碰 apps/web/.next）；`E2E_SKIP_BUILD=1` 且已有建置時略過
 * 3. `next start -p 3200`（前景執行，直到 Playwright 結束它）
 *
 * next build 在 distDir 不是 .next 時會自動改寫 tsconfig.json 的 include 與 next-env.d.ts；
 * 建置後把兩個檔案還原成建置前的位元組，避免工作目錄被弄髒。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_DIST_DIR, E2E_PORT, WEB_DIR, serverEnv, testDatabaseUrl } from "./env";
import { seedE2eDatabase } from "./seed";

const NEXT_BIN = require.resolve("next/dist/bin/next", { paths: [WEB_DIR] });
const RESTORE_FILES = ["tsconfig.json", "next-env.d.ts"];

function snapshot(): Map<string, Buffer | null> {
  const m = new Map<string, Buffer | null>();
  for (const f of RESTORE_FILES) {
    const p = path.join(WEB_DIR, f);
    m.set(p, existsSync(p) ? readFileSync(p) : null);
  }
  return m;
}

function restore(snap: Map<string, Buffer | null>): void {
  for (const [p, before] of snap) {
    if (before === null) continue;
    const now = existsSync(p) ? readFileSync(p) : null;
    if (!now || !now.equals(before)) writeFileSync(p, before);
  }
}

function build(env: NodeJS.ProcessEnv): void {
  const buildId = path.resolve(WEB_DIR, E2E_DIST_DIR, "BUILD_ID");
  if (process.env.E2E_SKIP_BUILD === "1" && existsSync(buildId)) {
    console.log(`[e2e] E2E_SKIP_BUILD=1，沿用既有建置（${E2E_DIST_DIR}）`);
    return;
  }
  console.log(`[e2e] next build → ${E2E_DIST_DIR}`);
  const snap = snapshot();
  try {
    const r = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: WEB_DIR, env, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`next build 失敗（exit ${r.status ?? r.signal}）`);
  } finally {
    restore(snap);
  }
}

async function main(): Promise<void> {
  // 先確定測試庫網址（名稱必須以 _test 結尾），seed 與伺服器都只連它
  const testUrl = testDatabaseUrl();
  process.env.DATABASE_URL = testUrl;
  console.log("[e2e] 重建測試資料庫並寫入 fixture");
  await seedE2eDatabase();

  const env = serverEnv();
  build(env);

  console.log(`[e2e] next start -p ${E2E_PORT}`);
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(E2E_PORT)], { cwd: WEB_DIR, env, stdio: "inherit" });
  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main().catch((err: unknown) => {
  console.error("[e2e] 伺服器啟動失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
