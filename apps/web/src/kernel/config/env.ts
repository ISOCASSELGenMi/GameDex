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
  /** 本機開發可設 false 關閉排程（例如同時開多個 dev server）。 */
  SCHEDULER_ENABLED: bool("true"),
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
