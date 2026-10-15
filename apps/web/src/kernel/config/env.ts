import { z } from "zod";

/**
 * 核心環境變數（kernel／catalog 需要的部分）。
 * 可選模組的變數由各模組 manifest 的 `requiredEnv` 在啟動時驗證（02 §Manifest）。
 * 規則：空字串視為未設（16 §環境變數）；驗證失敗 → 拒絕啟動（fail closed）。
 */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const csv = (fallback: string) =>
  z
    .preprocess(emptyToUndefined, z.string().default(fallback))
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const bool = (fallback: "true" | "false") =>
  z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default(fallback)).transform((s) => s === "true");

export const coreEnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "production", "test"]).default("development")),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().regex(/^postgres(ql)?:\/\//, "必須是 postgres:// 連線字串")),
  NEXT_PUBLIC_SITE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  MODULES: z.preprocess(emptyToUndefined, z.string().optional()),
  METACRITIC_SCRAPE_ENABLED: bool("false"),
  SUPPORTED_LOCALES: csv("zh-Hant,en,ja"),
  DEFAULT_LOCALE: z.preprocess(emptyToUndefined, z.string().default("zh-Hant")),
  DEFAULT_REGION_PREF: z.preprocess(emptyToUndefined, z.string().default("WW")),
  /** 月曆、時間軸、公開 iCal、Discord 預設顯示的遊戲類型與上市階段（04 §遊戲類型、§上市階段對照；16）。 */
  CALENDAR_VISIBLE_GAME_TYPES: csv("main_game,standalone_expansion,remake,remaster,port"),
  CALENDAR_VISIBLE_RELEASE_STAGES: csv("unspecified,full,early_access"),
  /**
   * 評分顯示（05 §顯示規則）。這裡只負責切成名稱陣列；已知來源名稱的驗證在 catalog 的啟動掛鉤
   * （kernel 不 import 模組）。VISIBLE 空＝不過濾；PRIORITY 預設 metacritic_scrape,igdb。
   */
  VISIBLE_SCORE_PROVIDERS: csv(""),
  RATING_DISPLAY_PRIORITY: csv("metacritic_scrape,igdb"),
  /** 本機開發可設 false 關閉排程（例如同時開多個 dev server）。 */
  SCHEDULER_ENABLED: bool("true"),
  /** catalog 的 manifest 把兩者列為 requiredEnv，啟動時檢查；這裡設為可選，讓單元測試與 build 不需要憑證。 */
  IGDB_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  IGDB_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 回填（04 §回填、16）：Tier 1 往回幾年；回填額外限速（每秒請求數），額度留給增量同步。 */
  BACKFILL_LOOKBACK_YEARS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).default(3)),
  BACKFILL_MAX_REQ_PER_SEC: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(4).default(2)),
  /** 滾動校對（04 §滾動校對）每晚重抓幾款；10000 ≈ 20 個請求，全庫約 43 天輪一遍（2026-10-13 定）。 */
  ROLLING_REFRESH_PER_NIGHT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(200000).default(10000)),
  /** 資料更正回報（12、16）：每 IP 每日（滾動 24 小時）上限、人機驗證、IP 雜湊金鑰、告警通道。 */
  REPORT_MAX_PER_IP_PER_DAY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10000).default(10)),
  TURNSTILE_SITE_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  TURNSTILE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** siteverify 網址；預設 Cloudflare 官方，測試時可指向本機假伺服器。 */
  TURNSTILE_VERIFY_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  /** reporterIpHash 的 HMAC 金鑰（≥16 字元）；production 缺少時回報端點回 503。 */
  REPORT_IP_HASH_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  ALERT_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  /** admin 模組的 /internal/* Basic auth（12）；未設＝整個 /internal 回 404。 */
  ADMIN_BASIC_AUTH_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  ADMIN_BASIC_AUTH_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 公開 iCal feed 事件上限（08、16）：releases.ics 依熱度取前 N 筆；起始值 500，依實測調整。 */
  ICAL_PUBLIC_MAX_EVENTS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100000).default(500)),
  /** 原型驗證用 feed（/ical/_proto/*，08、15 Phase 5）；只在本機／暫時性公開網址驗證客戶端行為時開啟，預設 false＝404。 */
  ICAL_PROTO_ENABLED: bool("false"),
  /** 熱度（03 §熱度、16）：站內追蹤權重達滿所需的全站追蹤總數（未驗證的起始值）。 */
  HEAT_COLD_START_FOLLOWS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(5000)),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

/** process.env 或測試用的物件。 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let cached: CoreEnv | undefined;

/** 解析並快取核心設定；任何錯誤都丟 ConfigError，不回傳部分結果。 */
export function getCoreEnv(env: EnvLike = process.env): CoreEnv {
  const useCache = env === process.env;
  if (useCache && cached) return cached;
  const parsed = coreEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`環境變數驗證失敗：${issues}`);
  }
  if (!parsed.data.SUPPORTED_LOCALES.includes(parsed.data.DEFAULT_LOCALE)) {
    throw new ConfigError(`DEFAULT_LOCALE=${parsed.data.DEFAULT_LOCALE} 不在 SUPPORTED_LOCALES 內`);
  }
  if (useCache) cached = parsed.data;
  return parsed.data;
}

/** 測試用：清除快取。 */
export function resetCoreEnvCache(): void {
  cached = undefined;
}

/** 空字串視為未設。 */
export function isEnvSet(name: string, env: EnvLike = process.env): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim() !== "";
}
