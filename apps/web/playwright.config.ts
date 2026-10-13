/**
 * test:a11y（06 §無障礙與響應式、14 §前端、15 Phase 3a）：Playwright＋axe-core。
 *
 * - 伺服器：webServer 執行 e2e/support/server.ts → 重建「測試資料庫」＋fixture → next build（輸出到 .local/e2e-next）
 *   → next start，埠 3200。只連 TEST_DATABASE_URL。
 * - 瀏覽器：CI 用 Playwright 自帶的 chromium（workflow 先 `playwright install --with-deps chromium`）；
 *   本機（Windows）預設用系統的 Edge（channel msedge），不需要 `playwright install`。
 *   `PW_CHANNEL=chrome|msedge|chromium` 可覆寫（chromium＝自帶瀏覽器）。
 * - 不要和 `npm test`（整合測試）同時跑：兩者都會重建同一個測試資料庫。
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_ARTIFACT_DIR, E2E_BASE_URL } from "./e2e/support/env";

const isCI = !!process.env.CI;

function browserChannel(): string | undefined {
  const v = process.env.PW_CHANNEL;
  if (v) return v === "chromium" ? undefined : v;
  if (isCI) return undefined;
  return process.platform === "win32" ? "msedge" : undefined;
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: path.join(E2E_ARTIFACT_DIR, "test-results"),
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: path.join(E2E_ARTIFACT_DIR, "report") }]]
    : [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "zh-TW",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: browserChannel() },
    },
  ],
  webServer: {
    command: "tsx e2e/support/server.ts",
    url: `${E2E_BASE_URL}/healthz`,
    // 預設不沿用既有伺服器：fixture 每次重建、建置每次重做。迭代時可先手動起伺服器再設 PW_REUSE_SERVER=1。
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
