/**
 * e2e（test:a11y）共用設定：埠、建置輸出目錄、伺服器環境變數。
 * playwright.config.ts、server.ts 與測試檔共用；不 import 任何 src/ 程式。
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveTestDatabaseUrl } from "../../test/integration/test-db-url";

/** e2e 伺服器的 NEXT_PUBLIC_SITE_URL（SEO 斷言用）。 */
export const E2E_SITE_ORIGIN = "https://sok.example";

/** 不用 3100（企劃負責人的 dev server）。 */
export const E2E_PORT = Number(process.env.E2E_PORT || 3200);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** admin 模組 /internal/* 的 Basic auth（reports-4.spec.ts 用；只存在於 e2e 伺服器的環境變數）。 */
export const E2E_ADMIN_USER = "e2e-admin";
export const E2E_ADMIN_PASS = "e2e-admin-pass";
/** Cloudflare Turnstile 官方測試金鑰（永遠通過；12）。伺服器端驗證會連到 Cloudflare 的 siteverify。 */
export const E2E_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
export const E2E_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** accounts（Phase 7）：e2e 專用的金鑰與開關；只存在於 e2e 伺服器的環境變數（不寫 .env.local）。 */
export const E2E_AUTH_SECRET = "e2e-auth-secret-0123456789abcdefghijklmnopqrstuv";
export const E2E_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
/** 第二個伺服器（註冊關閉）的埠：accounts-7.spec.ts 自己啟動，沿用同一份建置。 */
export const E2E_CLOSED_PORT = E2E_PORT + 50;
export const E2E_CLOSED_BASE_URL = `http://localhost:${E2E_CLOSED_PORT}`;

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
    // 測試假設三個語系都開放、預設 zh-Hant（不受 .env.local 影響）
    SUPPORTED_LOCALES: "zh-Hant,en,ja",
    DEFAULT_LOCALE: "zh-Hant",
    // SEO 測試：canonical／hreflang／sitemap 用絕對網址（沒設時會退回相對網址）
    NEXT_PUBLIC_SITE_URL: E2E_SITE_ORIGIN,
    // catalog manifest 把 IGDB 憑證列為 requiredEnv；排程關閉時不會呼叫 IGDB，用假值通過啟動檢查
    IGDB_CLIENT_ID: "e2e-dummy",
    IGDB_CLIENT_SECRET: "e2e-dummy",
    // 資料更正回報與管理介面（Phase 4 Slice 2）：e2e 專用的帳密與測試金鑰；上限放寬（所有請求都來自同一個 IP）
    ADMIN_BASIC_AUTH_USER: E2E_ADMIN_USER,
    ADMIN_BASIC_AUTH_PASS: E2E_ADMIN_PASS,
    TURNSTILE_SITE_KEY: E2E_TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: E2E_TURNSTILE_SECRET_KEY,
    REPORT_IP_HASH_SECRET: "e2e-report-ip-hash-secret-0123456789",
    REPORT_MAX_PER_IP_PER_DAY: "500",
    // accounts（Phase 7）：註冊開啟；可信來源含 e2e 伺服器本身（NEXT_PUBLIC_SITE_URL 是假網域）
    AUTH_SECRET: E2E_AUTH_SECRET,
    TOKEN_ENCRYPTION_KEY: E2E_TOKEN_ENCRYPTION_KEY,
    ACCOUNTS_SIGNUP_ENABLED: "true",
    // next start 是 production，限流預設啟用；CI 所有請求同一 IP 會被擋（429），e2e 關閉（限流本身由整合測試驗證）
    AUTH_RATE_LIMIT_ENABLED: "false",
    AUTH_TRUSTED_ORIGINS: `${E2E_BASE_URL},${E2E_CLOSED_BASE_URL}`,
    NEXT_DIST_DIR: E2E_DIST_DIR,
    // 彩蛋測試掛鉤（window.__eggTest）：只在 e2e 建置啟用；production 建置不設定，不暴露
    NEXT_PUBLIC_EGG_TEST: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(E2E_PORT),
  };
}
