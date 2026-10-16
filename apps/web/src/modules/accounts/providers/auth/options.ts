/**
 * Better Auth 設定組裝（09、03 §帳號；D76～D81）。純函式：資料庫轉接器、寄信、環境由呼叫端注入
 * （Provider 層不 import Repository；組裝在 use-cases/auth-instance.ts）。
 *
 * 表對應（modelName／欄位名是 drizzle 匯出名與屬性名，不是 SQL 名稱）：
 *   user→users、account→connectedAccounts、session→sessions、verification→authVerifications。
 * 偏好、role、suspendedAt 不宣告為 additionalFields：Better Auth 的端點碰不到，一律走 accounts 自己的 use case。
 */
import type { BetterAuthOptions } from "better-auth";
import type { AccountsEnv } from "./env";
import { createTokenCipher, type TokenCipher } from "./token-cipher";
import { hashPassword, verifyPassword } from "./password";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../../domain/entities/password-policy";
import { skipPlaceholderRecipients, type AccountMailer } from "./mailer";
import { SOCIAL_PROVIDERS, type SocialProvider } from "../../domain/entities/providers";
import { createSteamClient } from "../steam";
import { steam } from "./steam";

/** 對外路徑（D81）：OAuth redirect URI 為 `{站台}/api/v1/auth/callback/{provider}`。 */
export const AUTH_BASE_PATH = "/api/v1/auth";

/** 登入、註冊、重設端點的限流（09）。單機部署用記憶體儲存；要多實例時改 rateLimit.storage = "database"。 */
export const AUTH_RATE_LIMIT_RULES = {
  "/sign-in/email": { window: 60, max: 10 },
  "/sign-up/email": { window: 3600, max: 10 },
  "/request-password-reset": { window: 3600, max: 5 },
  "/reset-password": { window: 3600, max: 10 },
} as const;

export interface BuildAuthOptionsInput {
  env: AccountsEnv;
  database: NonNullable<BetterAuthOptions["database"]>;
  mailer: AccountMailer;
  /** 測試用：覆寫限流開關（優先於 env.rateLimitEnabled；後者預設只在 production 啟用）。 */
  rateLimitEnabled?: boolean;
  /** Steam 登入的 fetch（測試注入假的 Steam 回應；預設全域 fetch）。同時用於 OpenID 驗證與 GetPlayerSummaries。 */
  steamFetch?: typeof fetch;
}

const DISCORD_SCOPES = ["guilds"]; // 預設已含 identify email；guilds 供 10 §網站建立活動判斷伺服器權限
const MICROSOFT_SCOPES = ["XboxLive.signin", "offline_access"]; // Xbox 登入與匯入（9 §Xbox）

function socialProviders(env: AccountsEnv): NonNullable<BetterAuthOptions["socialProviders"]> {
  const disableSignUp = !env.signupEnabled;
  const out: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  for (const name of SOCIAL_PROVIDERS) {
    const c = env.socialCredentials[name];
    if (!c) continue;
    const base = { clientId: c.clientId, clientSecret: c.clientSecret, disableSignUp };
    switch (name satisfies SocialProvider) {
      case "discord":
        out.discord = { ...base, scope: DISCORD_SCOPES };
        break;
      case "google":
        out.google = base;
        break;
      case "twitch":
        out.twitch = base;
        break;
      case "twitter":
        out.twitter = base;
        break;
      case "microsoft":
        out.microsoft = { ...base, scope: MICROSOFT_SCOPES };
        break;
    }
  }
  return out;
}

function encryptIfPresent(cipher: TokenCipher, value: string | null | undefined): string | null | undefined {
  return typeof value === "string" && value !== "" && !cipher.isEncrypted(value) ? cipher.encrypt(value) : value;
}

export function buildAuthOptions(input: BuildAuthOptionsInput): BetterAuthOptions {
  const { env, database } = input;
  const mailer = skipPlaceholderRecipients(input.mailer);
  const cipher = createTokenCipher(env.tokenKey);
  const encryptTokens = <T extends { accessToken?: string | null; refreshToken?: string | null; idToken?: string | null }>(a: T): T => ({
    ...a,
    ...(a.accessToken !== undefined ? { accessToken: encryptIfPresent(cipher, a.accessToken) } : {}),
    ...(a.refreshToken !== undefined ? { refreshToken: encryptIfPresent(cipher, a.refreshToken) } : {}),
    ...(a.idToken !== undefined ? { idToken: encryptIfPresent(cipher, a.idToken) } : {}),
  });

  return {
    secret: env.authSecret,
    baseURL: env.siteUrl,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: env.trustedOrigins,
    database,
    advanced: {
      // 整數 id（D1）：對外仍是字串，accounts 邊界轉 number
      database: { generateId: "serial" },
      // Caddy 保證 CF-Connecting-IP 可信（infra/Caddyfile）；限流與 session 紀錄用它
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    user: {
      modelName: "users",
      fields: { name: "displayName", image: "avatarUrl" },
    },
    account: {
      modelName: "connectedAccounts",
      fields: { providerId: "provider", accountId: "providerAccountId", accessTokenExpiresAt: "expiresAt", createdAt: "connectedAt" },
      // 不自動依信箱合併：不同登入方式要由登入後的使用者明確綁定（避免未驗證信箱的接管）
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: true },
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // cookie cache 命中時 get-session 不送 Set-Cookie（K 報告實測）
      cookieCache: { enabled: true, maxAge: 300 },
    },
    verification: { modelName: "authVerifications", storeIdentifier: "hashed" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !env.signupEnabled,
      requireEmailVerification: false, // 09：未驗證只限制「開啟 Email 通知」（7.5）
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: 3600,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendPasswordReset({ to: user.email, displayName: user.name, url });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.sendVerification({ to: user.email, displayName: user.name, url });
      },
    },
    socialProviders: socialProviders(env),
    plugins: [
      steam({
        signupEnabled: env.signupEnabled,
        fetch: input.steamFetch,
        // 有 STEAM_WEB_API_KEY 才取暱稱與頭像；失敗不擋登入（plugin 端 catch）
        fetchProfile: env.steamApiKey
          ? (steamId) => createSteamClient({ apiKey: env.steamApiKey as string, fetch: input.steamFetch }).getPlayerSummary(steamId)
          : undefined,
      }),
    ],
    rateLimit: {
      enabled: input.rateLimitEnabled ?? env.rateLimitEnabled,
      customRules: { ...AUTH_RATE_LIMIT_RULES },
    },
    databaseHooks: {
      user: {
        // 註冊關閉時，任何路徑（Email、社群、之後的 Steam）都不得建立新使用者；既有帳號登入不受影響
        create: { before: async () => (env.signupEnabled ? undefined : false) },
      },
      account: {
        create: { before: async (account) => ({ data: encryptTokens(account) }) },
        update: { before: async (account) => ({ data: encryptTokens(account) }) },
      },
    },
  };
}
