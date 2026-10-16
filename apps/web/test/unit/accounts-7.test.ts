/**
 * Phase 7 第 1 波單元測試（不需要資料庫）：placeholder 信箱、provider 常數、token 加密、環境變數、
 * Better Auth 設定組裝（註冊開關、限流、只啟用有憑證的 provider）、argon2id、安全的 next 路徑、模組可移除性。
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { validateModules } from "@/kernel/modules/startup";
import {
  AUTH_PROVIDERS,
  AUTH_TOKEN_PURPOSES,
  SOCIAL_PROVIDERS,
  isAuthProvider,
  isExternalProvider,
  isPlaceholderEmail,
  placeholderEmail,
} from "@/modules/accounts/domain/entities";
import {
  AUTH_BASE_PATH,
  AUTH_RATE_LIMIT_RULES,
  AccountsConfigError,
  buildAuthOptions,
  createLogMailer,
  createTokenCipher,
  hashPassword,
  parseAccountsEnv,
  readAccountsPublicConfig,
  skipPlaceholderRecipients,
  verifyPassword,
  type AccountMailer,
} from "@/modules/accounts/providers/auth";
import { accountPageHref, safeNextPath } from "@/modules/accounts/ui/links";
import { authSubPath } from "@/modules/accounts/use-cases/auth-request";
import { accountsModule } from "@/modules/accounts";
import { enabledModules } from "@/modules/registry";

const KEY = randomBytes(32).toString("base64");
const SECRET = "unit-test-auth-secret-0123456789abcdefghij";
const baseEnv = { AUTH_SECRET: SECRET, TOKEN_ENCRYPTION_KEY: KEY, NODE_ENV: "test" };

describe("placeholder 信箱（D77）", () => {
  it("placeholderEmail 組成 <id>@<provider>.placeholder.invalid（小寫）", () => {
    expect(placeholderEmail("76561198000000001", "steam")).toBe("76561198000000001@steam.placeholder.invalid");
    expect(placeholderEmail("ABC", "Twitter")).toBe("abc@twitter.placeholder.invalid");
  });
  it("isPlaceholderEmail：只認 .placeholder.invalid 網域", () => {
    expect(isPlaceholderEmail("1@steam.placeholder.invalid")).toBe(true);
    expect(isPlaceholderEmail("1@STEAM.PLACEHOLDER.INVALID")).toBe(true);
    expect(isPlaceholderEmail("a@example.com")).toBe(false);
    expect(isPlaceholderEmail("a@placeholder.invalid.example.com")).toBe(false);
    expect(isPlaceholderEmail("placeholder.invalid")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
  });
  it("寄信包裝：收件人是 placeholder 時一律略過", async () => {
    const sent: string[] = [];
    const inner: AccountMailer = {
      sendVerification: async (m) => void sent.push(`v:${m.to}`),
      sendPasswordReset: async (m) => void sent.push(`r:${m.to}`),
    };
    const m = skipPlaceholderRecipients(inner);
    await m.sendPasswordReset({ to: "1@steam.placeholder.invalid", displayName: "x", url: "u" });
    await m.sendVerification({ to: "1@steam.placeholder.invalid", displayName: "x", url: "u" });
    await m.sendPasswordReset({ to: "a@example.com", displayName: "x", url: "u" });
    expect(sent).toEqual(["r:a@example.com"]);
  });
  it("log 實作只寫 log、不丟例外", async () => {
    const lines: string[] = [];
    const m = createLogMailer((l) => lines.push(l));
    await m.sendPasswordReset({ to: "a@example.com", displayName: "A", url: "http://x/y" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("http://x/y");
  });
});

describe("provider 常數（D78）", () => {
  it("包含 credential 與 microsoft（xbox 作廢）、不含 psn／nintendo", () => {
    expect(AUTH_PROVIDERS).toContain("credential");
    expect(AUTH_PROVIDERS).toContain("microsoft");
    expect(AUTH_PROVIDERS).not.toContain("xbox" as never);
    expect(isAuthProvider("steam")).toBe(true);
    expect(isAuthProvider("psn")).toBe(false);
  });
  it("社群登入不含 credential 與 steam；credential 不算外部帳號", () => {
    expect(SOCIAL_PROVIDERS).not.toContain("credential" as never);
    expect(SOCIAL_PROVIDERS).not.toContain("steam" as never);
    expect(isExternalProvider("credential")).toBe(false);
    expect(isExternalProvider("discord")).toBe(true);
  });
  it("auth_tokens 只剩通知確認", () => {
    expect([...AUTH_TOKEN_PURPOSES]).toEqual(["confirm_notifications"]);
  });
});

describe("token 加密（AES-256-GCM）", () => {
  const cipher = createTokenCipher(Buffer.from(KEY, "base64"));
  it("加密後解得回原文、每次密文不同、格式 v1.iv.tag.ct", () => {
    const a = cipher.encrypt("access-token-秘密");
    const b = cipher.encrypt("access-token-秘密");
    expect(a).not.toBe(b);
    expect(a).not.toContain("access-token");
    expect(a.split(".")).toHaveLength(4);
    expect(a.startsWith("v1.")).toBe(true);
    expect(cipher.decrypt(a)).toBe("access-token-秘密");
    expect(cipher.isEncrypted(a)).toBe(true);
    expect(cipher.isEncrypted("plain")).toBe(false);
  });
  it("密文被竄改、金鑰不同 → 解密失敗", () => {
    const a = cipher.encrypt("secret");
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => cipher.decrypt(parts.join("."))).toThrow();
    const other = createTokenCipher(randomBytes(32));
    expect(() => other.decrypt(a)).toThrow();
    expect(() => cipher.decrypt("not-a-cipher")).toThrow();
  });
  it("金鑰不是 32 bytes → 拒絕", () => {
    expect(() => createTokenCipher(randomBytes(16))).toThrow();
  });
});

describe("parseAccountsEnv", () => {
  it("缺 AUTH_SECRET／過短／TOKEN_ENCRYPTION_KEY 格式不對 → AccountsConfigError", () => {
    expect(() => parseAccountsEnv({ TOKEN_ENCRYPTION_KEY: KEY })).toThrow(AccountsConfigError);
    expect(() => parseAccountsEnv({ AUTH_SECRET: "short", TOKEN_ENCRYPTION_KEY: KEY })).toThrow(/AUTH_SECRET/);
    expect(() => parseAccountsEnv({ AUTH_SECRET: SECRET, TOKEN_ENCRYPTION_KEY: "abc" })).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => parseAccountsEnv({ AUTH_SECRET: SECRET })).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
  it("註冊預設關閉；空字串視為未設；'true' 才開", () => {
    expect(parseAccountsEnv(baseEnv).signupEnabled).toBe(false);
    expect(parseAccountsEnv({ ...baseEnv, ACCOUNTS_SIGNUP_ENABLED: "" }).signupEnabled).toBe(false);
    expect(parseAccountsEnv({ ...baseEnv, ACCOUNTS_SIGNUP_ENABLED: "true" }).signupEnabled).toBe(true);
    expect(() => parseAccountsEnv({ ...baseEnv, ACCOUNTS_SIGNUP_ENABLED: "yes" })).toThrow();
  });
  it("social provider：client id 與 secret 兩者都有才啟用", () => {
    const env = parseAccountsEnv({
      ...baseEnv,
      DISCORD_CLIENT_ID: "d",
      DISCORD_CLIENT_SECRET: "ds",
      GOOGLE_CLIENT_ID: "g", // 缺 secret
      TWITCH_CLIENT_SECRET: "t", // 缺 id
      MICROSOFT_CLIENT_ID: " ",
      MICROSOFT_CLIENT_SECRET: "m",
    });
    expect(Object.keys(env.socialCredentials)).toEqual(["discord"]);
    expect(readAccountsPublicConfig({ ...baseEnv, DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "ds", ACCOUNTS_SIGNUP_ENABLED: "true" })).toEqual({
      signupEnabled: true,
      socialProviders: ["discord"],
    });
  });
  it("trustedOrigins：站台網址＋AUTH_TRUSTED_ORIGINS（去重、去空白）", () => {
    const env = parseAccountsEnv({ ...baseEnv, NEXT_PUBLIC_SITE_URL: "https://sok.example/", AUTH_TRUSTED_ORIGINS: "http://localhost:3277, https://sok.example ,," });
    expect(env.trustedOrigins).toEqual(["https://sok.example", "http://localhost:3277"]);
    expect(env.siteUrl).toBe("https://sok.example");
  });
});

describe("Better Auth 設定組裝", () => {
  const database = {} as never;
  const mailer: AccountMailer = createLogMailer(() => {});
  type SocialOpts = { disableSignUp?: boolean; scope?: string[] };
  const social = (o: ReturnType<typeof build>, name: "discord" | "microsoft") => o.socialProviders?.[name] as unknown as SocialOpts;
  const build = (extra: Record<string, string> = {}, rateLimitEnabled?: boolean) =>
    buildAuthOptions({ env: parseAccountsEnv({ ...baseEnv, ...extra }), database, mailer, rateLimitEnabled });

  it("basePath 為 /api/v1/auth（D81）、整數 id、modelName 對到我方表", () => {
    const o = build();
    expect(o.basePath).toBe(AUTH_BASE_PATH);
    expect(AUTH_BASE_PATH).toBe("/api/v1/auth");
    expect(o.advanced?.database?.generateId).toBe("serial");
    expect(o.user?.modelName).toBe("users");
    expect(o.account?.modelName).toBe("connectedAccounts");
    expect(o.session?.modelName).toBe("sessions");
    expect(o.verification?.modelName).toBe("authVerifications");
    expect(o.verification?.storeIdentifier).toBe("hashed");
    // 不用 BA 內建的 OAuth token 加密（用 TOKEN_ENCRYPTION_KEY＋databaseHooks，D10）
    expect(o.account?.encryptOAuthTokens).toBeUndefined();
  });
  it("註冊開關：預設關閉 → Email 與所有 social 都 disableSignUp；開啟後才允許", () => {
    const closed = build({ DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s" });
    expect(closed.emailAndPassword?.disableSignUp).toBe(true);
    expect(social(closed, "discord").disableSignUp).toBe(true);
    const open = build({ DISCORD_CLIENT_ID: "d", DISCORD_CLIENT_SECRET: "s", ACCOUNTS_SIGNUP_ENABLED: "true" });
    expect(open.emailAndPassword?.disableSignUp).toBe(false);
    expect(social(open, "discord").disableSignUp).toBe(false);
  });
  it("只啟用有憑證的 social provider；Discord 帶 guilds、Microsoft 帶 XboxLive.signin", () => {
    expect(Object.keys(build().socialProviders ?? {})).toEqual([]);
    const all: Record<string, string> = {};
    for (const p of SOCIAL_PROVIDERS) {
      all[`${p.toUpperCase()}_CLIENT_ID`] = "id";
      all[`${p.toUpperCase()}_CLIENT_SECRET`] = "secret";
    }
    const o = build(all);
    expect(Object.keys(o.socialProviders ?? {}).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
    expect(social(o, "discord").scope).toContain("guilds");
    expect(social(o, "microsoft").scope).toContain("XboxLive.signin");
  });
  it("限流：登入、註冊、重設都有明列規則；預設只在 production 啟用", () => {
    expect(Object.keys(AUTH_RATE_LIMIT_RULES).sort()).toEqual(["/request-password-reset", "/reset-password", "/sign-in/email", "/sign-up/email"]);
    expect(build().rateLimit?.enabled).toBe(false);
    expect(build({ NODE_ENV: "production" }).rateLimit?.enabled).toBe(true);
    expect(build({}, true).rateLimit?.enabled).toBe(true);
    // AUTH_RATE_LIMIT_ENABLED：明確設定優先於 NODE_ENV；rateLimitEnabled 參數優先於 env
    expect(build({ NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "false" }).rateLimit?.enabled).toBe(false);
    expect(build({ AUTH_RATE_LIMIT_ENABLED: "true" }).rateLimit?.enabled).toBe(true);
    expect(build({ NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "" }).rateLimit?.enabled).toBe(true);
    expect(build({ NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "false" }, true).rateLimit?.enabled).toBe(true);
    expect(build().rateLimit?.customRules).toMatchObject({ "/sign-in/email": { max: expect.any(Number) } });
  });
  it("重設密碼 token 一小時；密碼最短 10；Email 驗證不強制（09）", () => {
    const o = build();
    expect(o.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(3600);
    expect(o.emailAndPassword?.minPasswordLength).toBe(10);
    expect(o.emailAndPassword?.requireEmailVerification).toBe(false);
  });
  it("account.create／update 的 hook 會加密 token；已加密的不重複加密；null 保持 null", async () => {
    const o = build();
    const cipher = createTokenCipher(Buffer.from(KEY, "base64"));
    const create = o.databaseHooks?.account?.create?.before;
    expect(create).toBeTypeOf("function");
    const out = (await create!({ accessToken: "AT", refreshToken: "RT", idToken: null, scope: "x" } as never, null)) as { data: Record<string, string | null> };
    expect(out.data.accessToken).not.toBe("AT");
    expect(cipher.decrypt(out.data.accessToken as string)).toBe("AT");
    expect(cipher.decrypt(out.data.refreshToken as string)).toBe("RT");
    expect(out.data.idToken).toBeNull();
    expect(out.data.scope).toBe("x");
    const again = (await create!({ accessToken: out.data.accessToken } as never, null)) as { data: Record<string, string> };
    expect(again.data.accessToken).toBe(out.data.accessToken);
    const update = o.databaseHooks?.account?.update?.before;
    const upd = (await update!({ accessToken: "AT2" } as never, null)) as { data: Record<string, string> };
    expect(cipher.decrypt(upd.data.accessToken)).toBe("AT2");
    expect("refreshToken" in upd.data).toBe(false);
  });
  it("註冊關閉時，建立使用者的 hook 回傳 false（任何路徑都不能新增使用者）", async () => {
    const before = build().databaseHooks?.user?.create?.before;
    expect(await before!({} as never, null)).toBe(false);
    const open = build({ ACCOUNTS_SIGNUP_ENABLED: "true" }).databaseHooks?.user?.create?.before;
    expect(await open!({} as never, null)).toBeUndefined();
  });
});

describe("argon2id", () => {
  it("雜湊格式為 $argon2id$（m=19456,t=2,p=1）；驗證對錯；壞雜湊回 false 不丟例外", async () => {
    const h = await hashPassword("a long password 1");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword({ hash: h, password: "a long password 1" })).toBe(true);
    expect(await verifyPassword({ hash: h, password: "wrong password!" })).toBe(false);
    expect(await verifyPassword({ hash: "not-a-hash", password: "x" })).toBe(false);
  });
});

describe("網址與 next 路徑", () => {
  it("safeNextPath：只接受站內相對路徑", () => {
    expect(safeNextPath("/zh-Hant/account", "/x")).toBe("/zh-Hant/account");
    expect(safeNextPath(null, "/x")).toBe("/x");
    expect(safeNextPath("https://evil.example/", "/x")).toBe("/x");
    expect(safeNextPath("//evil.example", "/x")).toBe("/x");
    expect(safeNextPath("/\\evil.example", "/x")).toBe("/x");
    expect(safeNextPath("/a\nb", "/x")).toBe("/x");
  });
  it("accountPageHref 與 authSubPath", () => {
    expect(accountPageHref("en", "login")).toBe("/en/login");
    expect(accountPageHref("ja", "login", "next=%2Fja%2Faccount")).toBe("/ja/login?next=%2Fja%2Faccount");
    expect(authSubPath("http://localhost/api/v1/auth/sign-in/email?x=1")).toBe("/sign-in/email");
    expect(authSubPath("http://localhost/api/v1/auth")).toBe("/");
  });
});

describe("可移除性（02）", () => {
  const saved = process.env.MODULES;
  afterEach(() => {
    if (saved === undefined) delete process.env.MODULES;
    else process.env.MODULES = saved;
  });

  it("manifest：requiredEnv、ownedTables、每晚清理任務", () => {
    expect(accountsModule.name).toBe("accounts");
    expect(accountsModule.kind).toBe("optional");
    expect(accountsModule.requiredEnv).toEqual(["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY"]);
    expect(accountsModule.ownedTables).toEqual(["users", "connected_accounts", "sessions", "auth_verifications", "auth_tokens", "owned_games"]);
    expect(accountsModule.jobs?.map((j) => j.name)).toEqual(["cleanup_auth_rows", "match_owned_games"]);
    expect(accountsModule.uiSlots?.["header.right"]).toBeTypeOf("function");
  });
  it("MODULES=none：registry 不含 accounts（沒有 slot、沒有任務、不檢查 AUTH_SECRET）", () => {
    const none = enabledModules({ MODULES: "none" });
    expect(none.map((m) => m.name)).not.toContain("accounts");
    const core = { MODULES: "none", DATABASE_URL: "postgres://u:p@localhost/x", IGDB_CLIENT_ID: "a", IGDB_CLIENT_SECRET: "b" };
    expect(() => validateModules(none, core)).not.toThrow(); // AUTH_SECRET 都沒設也能啟動
    expect(enabledModules({ MODULES: "accounts" }).map((m) => m.name)).toContain("accounts");
  });
  it("accounts 啟用但缺 AUTH_SECRET／TOKEN_ENCRYPTION_KEY → 拒絕啟動", () => {
    const env = { MODULES: "accounts" };
    expect(() => validateModules(enabledModules(env), env)).toThrow(/AUTH_SECRET/);
    expect(() => validateModules(enabledModules(env), env)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    const ok = { ...env, ...baseEnv, DATABASE_URL: "postgres://u:p@localhost/x", IGDB_CLIENT_ID: "a", IGDB_CLIENT_SECRET: "b" };
    expect(() => validateModules(enabledModules(ok), ok)).not.toThrow();
  });
  it("MODULES=none：/api/v1/auth/* 回 404，且不會建立 Better Auth（不需要 AUTH_SECRET）", async () => {
    process.env.MODULES = "none";
    const route = await import("@/app/api/v1/auth/[...all]/route");
    const res = await route.GET(new Request("http://localhost/api/v1/auth/get-session"));
    expect(res.status).toBe(404);
    const post = await route.POST(new Request("http://localhost/api/v1/auth/sign-in/email", { method: "POST", body: "{}" }));
    expect(post.status).toBe(404);
  });
});
