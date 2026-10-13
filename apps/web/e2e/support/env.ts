/**
 * e2e（test:a11y）共用設定：埠、建置輸出目錄、伺服器環境變數。
 * playwright.config.ts、server.ts 與測試檔共用；不 import 任何 src/ 程式。
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveTestDatabaseUrl } from "../../test/integration/test-db-url";

/** 不用 3100（企劃負責人的 dev server）。 */
export const E2E_PORT = Number(process.env.E2E_PORT || 3200);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** apps/web 目錄（Playwright 與 tsx 都以它為 cwd 執行）。 */
export const WEB_DIR = path.resolve(__dirname, "..", "..");

/**
 * next build 的輸出目錄（相對 apps/web）。放在 repo 根目錄的 `.local/`（git 忽略、ESLint／tsc 都看不到），
 * 不寫 apps/web/.next（dev server 在用）。
 */
export const E2E_DIST_DIR = process.env.E2E_DIST_DIR || "../../.local/e2e-next";

/** Playwright 產物（截圖、trace、HTML 報告）也放 `.local/`。 */
export const E2E_ARTIFACT_DIR = path.resolve(WEB_DIR, "..", "..", ".local", "playwright");

/**
 * 讀 TEST_DATABASE_URL（與整合測試相同的來源：.env.test.local → .env.local → .env）；不印出。
 * 有 TEST_DATABASE_NAME 時換掉資料庫名稱（同 test/integration/test-db-url.ts；seed 的重建也走同一個函式）。
 */
export function testDatabaseUrl(): string {
  loadDotenv({ path: [".env.test.local", ".env.local", ".env"].map((f) => path.join(WEB_DIR, f)), quiet: true });
  const raw = resolveTestDatabaseUrl();
  if (!raw) throw new Error("test:a11y 需要 TEST_DATABASE_URL（資料庫名稱必須以 _test 結尾）");
  const dbName = new URL(raw).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`TEST_DATABASE_URL 的資料庫名稱必須以 _test 結尾：${dbName}`);
  return raw;
}

/**
 * e2e 伺服器的環境：一律連測試資料庫、不跑排程、不帶真 IGDB 憑證。
 * process.env 優先於 .env.local（Next 的載入器不覆寫已存在的變數），所以開發資料庫不會被碰到。
 */
export function serverEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: testDatabaseUrl(),
    SCHEDULER_ENABLED: "false",
    // 測試假設兩個語系都開放、預設 zh-Hant（不受 .env.local 影響）
    SUPPORTED_LOCALES: "zh-Hant,en",
    DEFAULT_LOCALE: "zh-Hant",
    // catalog manifest 把 IGDB 憑證列為 requiredEnv；排程關閉時不會呼叫 IGDB，用假值通過啟動檢查
    IGDB_CLIENT_ID: "e2e-dummy",
    IGDB_CLIENT_SECRET: "e2e-dummy",
    NEXT_DIST_DIR: E2E_DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(E2E_PORT),
  };
}
