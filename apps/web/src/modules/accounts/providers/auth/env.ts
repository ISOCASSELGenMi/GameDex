/**
 * accounts 的環境變數（16 §環境變數）。只在 accounts 啟用時才會被讀（getAuth() 是 lazy 的；MODULES 不含 accounts 時不會呼叫）。
 * 空字串視為未設。AUTH_SECRET 與 TOKEN_ENCRYPTION_KEY 同時是 manifest 的 requiredEnv（啟動時檢查）；這裡再驗證格式。
 * 各 social provider 的 *_CLIENT_ID／*_CLIENT_SECRET 不是 requiredEnv：兩者都有才啟用該 provider（可只試 Email＋密碼）。
 */
import { z } from "zod";
import type { AccountsPublicConfig } from "../../domain/entities/public-config";
import { SOCIAL_PROVIDERS, type SocialProvider } from "../../domain/entities/providers";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

/** 32 bytes 的 base64（標準或 URL-safe 皆可）。 */
export function decodeEncryptionKey(raw: string): Buffer | null {
  const buf = Buffer.from(raw.trim(), "base64");
  return buf.length === 32 ? buf : null;
}

const accountsEnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "production", "test"]).default("development")),
  /** Better Auth 的 session／cookie 簽章與驗證信 JWT（≥32 字元、高熵）。 */
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "AUTH_SECRET 至少 32 字元")),
  /** access／refresh／id token 的 AES-256-GCM 金鑰（32 bytes 的 base64）；與資料庫分開保管。 */
  TOKEN_ENCRYPTION_KEY: z.preprocess(
    emptyToUndefined,
    z.string().refine((v) => decodeEncryptionKey(v) !== null, "TOKEN_ENCRYPTION_KEY 必須是 32 bytes 的 base64"),
  ),
  NEXT_PUBLIC_SITE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  /** 額外可信來源（逗號分隔，例如 staging 網域或 e2e 的 localhost）；預設只信任 NEXT_PUBLIC_SITE_URL。 */
  AUTH_TRUSTED_ORIGINS: z.preprocess(emptyToUndefined, z.string().optional()),
  ACCOUNTS_SIGNUP_ENABLED: z
    .preprocess(emptyToUndefined, z.enum(["true", "false"]).default("false"))
    .transform((v) => v === "true"),
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  TWITCH_CLIENT_ID: optionalString,
  TWITCH_CLIENT_SECRET: optionalString,
  TWITTER_CLIENT_ID: optionalString,
  TWITTER_CLIENT_SECRET: optionalString,
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
});

export type AccountsEnvInput = Readonly<Record<string, string | undefined>>;

export interface AccountsEnv {
  isProduction: boolean;
  authSecret: string;
  tokenKey: Buffer;
  siteUrl: string | undefined;
  trustedOrigins: string[];
  signupEnabled: boolean;
  /** 兩個值都有才啟用。 */
  socialCredentials: Partial<Record<SocialProvider, { clientId: string; clientSecret: string }>>;
}

export class AccountsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountsConfigError";
  }
}

export function parseAccountsEnv(env: AccountsEnvInput = process.env): AccountsEnv {
  const parsed = accountsEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AccountsConfigError(`accounts 環境變數驗證失敗：${issues}`);
  }
  const d = parsed.data;
  const credentials: AccountsEnv["socialCredentials"] = {};
  for (const p of SOCIAL_PROVIDERS) {
    const id = d[`${p.toUpperCase()}_CLIENT_ID` as keyof typeof d] as string | undefined;
    const secret = d[`${p.toUpperCase()}_CLIENT_SECRET` as keyof typeof d] as string | undefined;
    if (id && secret) credentials[p] = { clientId: id, clientSecret: secret };
  }
  const siteUrl = d.NEXT_PUBLIC_SITE_URL ? new URL(d.NEXT_PUBLIC_SITE_URL).origin : undefined;
  const extra = (d.AUTH_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    isProduction: d.NODE_ENV === "production",
    authSecret: d.AUTH_SECRET,
    tokenKey: decodeEncryptionKey(d.TOKEN_ENCRYPTION_KEY) as Buffer,
    siteUrl,
    trustedOrigins: [...new Set([...(siteUrl ? [siteUrl] : []), ...extra])],
    signupEnabled: d.ACCOUNTS_SIGNUP_ENABLED,
    socialCredentials: credentials,
  };
}

export function readAccountsPublicConfig(env: AccountsEnvInput = process.env): AccountsPublicConfig {
  const providers = SOCIAL_PROVIDERS.filter((p) => {
    const id = env[`${p.toUpperCase()}_CLIENT_ID`]?.trim();
    const secret = env[`${p.toUpperCase()}_CLIENT_SECRET`]?.trim();
    return !!id && !!secret;
  });
  return { signupEnabled: env.ACCOUNTS_SIGNUP_ENABLED?.trim() === "true", socialProviders: providers };
}
