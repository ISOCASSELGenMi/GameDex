/**
 * Phase 7 第 1 波整合測試（真實 PG；Better Auth 經 handleAuthRequest，與 /api/v1/auth/* 路由同一條路）：
 * 註冊→登入→登出、錯誤密碼、argon2id 格式、重設密碼一次性、刪 users cascade、解綁最後一個登入方式被拒、
 * 已綁定清單排除 credential、OAuth token 加密落庫、註冊開關（路由 404、直接呼叫被拒、既有帳號仍可登入）、
 * placeholder 信箱不寄信、限流、每晚清理、get-session 不送 Set-Cookie、被封鎖的端點。
 * 信箱一律以 acc7- 開頭。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { authVerifications, connectedAccounts, sessions, users } from "@/modules/accounts/schema";
import { createAuth, createLogMailer, createTokenCipher, parseAccountsEnv, AUTH_BASE_PATH, type AccountMailer, type AccountMailMessage } from "@/modules/accounts/providers/auth";
import { createAuthDatabaseAdapter } from "@/modules/accounts/repository/auth-database";
import { cleanupExpiredAuthRows, getAuth, getCurrentUser, handleAuthRequest, listLinkedAccounts, resetAuthForTests, setAccountMailer } from "@/modules/accounts/use-cases";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const SECRET = "integration-auth-secret-0123456789abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "a long password 1";

const outbox = { reset: [] as AccountMailMessage[], verify: [] as AccountMailMessage[] };
const mailer: AccountMailer = {
  sendPasswordReset: async (m) => void outbox.reset.push(m),
  sendVerification: async (m) => void outbox.verify.push(m),
};

const ENV_KEYS = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "ACCOUNTS_SIGNUP_ENABLED", "NEXT_PUBLIC_SITE_URL", "MODULES"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(signup: boolean): void {
  process.env.AUTH_SECRET = SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  process.env.ACCOUNTS_SIGNUP_ENABLED = signup ? "true" : "false";
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  delete process.env.MODULES;
  resetAuthForTests();
  setAccountMailer(mailer);
}

const url = (p: string) => `${ORIGIN}${AUTH_BASE_PATH}${p}`;

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Request {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  return new Request(url(path), {
    method,
    headers: {
      origin: ORIGIN,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function signUp(email: string, name = "Acc Tester", password = PASSWORD): Promise<{ res: Response; cookie: string }> {
  const res = await handleAuthRequest(req("/sign-up/email", { body: { email, password, name } }));
  return { res, cookie: cookieOf(res) };
}

async function signIn(email: string, password = PASSWORD): Promise<Response> {
  return handleAuthRequest(req("/sign-in/email", { body: { email, password } }));
}

describe.skipIf(!enabled)("accounts：Better Auth＋Email 密碼（整合）", () => {
  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    setEnv(true);
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetAuthForTests();
    await closeDb();
  });

  it("註冊→登入→登出：users 為整數 id、email 轉小寫、session 寫入、Cookie 由 /api/v1/auth 設定、登出後 session 失效", async () => {
    const { res, cookie } = await signUp("Acc7-Flow@Example.com");
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);
    const [u] = await getDb().select().from(users).where(eq(users.email, "acc7-flow@example.com"));
    expect(u).toBeDefined();
    expect(Number.isInteger(u.id)).toBe(true);
    expect(u.displayName).toBe("Acc Tester");
    expect(u.role).toBe("member");
    expect(u.emailVerified).toBe(false);
    const accts = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u.id));
    expect(accts.map((a) => a.provider)).toEqual(["credential"]);
    expect(accts[0].providerAccountId).toBe(String(u.id));
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1);

    // 已登入：getCurrentUser 取得 number id 與 role
    const me = await getCurrentUser(new Headers({ cookie }));
    expect(me).toMatchObject({ id: u.id, role: "member", displayName: "Acc Tester", email: "acc7-flow@example.com", emailVerified: false });

    // 登入（新 session）
    const login = await signIn("acc7-flow@example.com");
    expect(login.status).toBe(200);
    const cookie2 = cookieOf(login);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(2);

    // 登出：該 session 被刪，之後 get-session 回 null
    const out = await handleAuthRequest(req("/sign-out", { body: {}, cookie: cookie2 }));
    expect(out.status).toBe(200);
    // 回應要清掉瀏覽器的 Cookie（Max-Age=0）
    expect(out.headers.getSetCookie().filter((c) => /max-age=0/i.test(c)).length).toBeGreaterThanOrEqual(1);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1);
    // 只帶 session token（不帶 cookie cache）→ 伺服器端查 DB，已失效。
    // 取捨：session cookie cache（5 分鐘）讓每頁的 get-session 不必查 DB，代價是被偷走的舊 cookie 最長 5 分鐘內仍有效。
    const tokenOnly = cookie2.split("; ").filter((c) => c.includes("session_token")).join("; ");
    const after = await handleAuthRequest(req("/get-session", { cookie: tokenOnly }));
    expect(await after.json()).toBeNull();
  });

  it("錯誤密碼 → 401；不存在的信箱 → 401；密碼太短 → 400；重複信箱 → 4xx；姓名太長 → 400", async () => {
    await signUp("acc7-wrong@example.com");
    expect((await signIn("acc7-wrong@example.com", "wrong password here")).status).toBe(401);
    expect((await signIn("acc7-nobody@example.com")).status).toBe(401);
    expect((await signUp("acc7-short@example.com", "S", "short")).res.status).toBe(400);
    const dup = await signUp("acc7-wrong@example.com");
    expect(dup.res.status).toBeGreaterThanOrEqual(400);
    expect(dup.res.status).toBeLessThan(500);
    const longName = await signUp("acc7-longname@example.com", "n".repeat(101));
    expect(longName.res.status).toBe(400);
    expect((await longName.res.json()).code).toBe("NAME_TOO_LONG");
  });

  it("密碼以 argon2id 儲存（只在 credential 列）", async () => {
    await signUp("acc7-argon@example.com");
    const [u] = await getDb().select().from(users).where(eq(users.email, "acc7-argon@example.com"));
    const [a] = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u.id));
    expect(a.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a.password).not.toContain(PASSWORD);
  });

  it("重設密碼：連結只能用一次、一小時、DB 只存雜湊；舊密碼失效、新密碼可登入", async () => {
    await signUp("acc7-reset@example.com");
    outbox.reset.length = 0;
    const r = await handleAuthRequest(req("/request-password-reset", { body: { email: "acc7-reset@example.com", redirectTo: "/zh-Hant/reset-password" } }));
    expect(r.status).toBe(200);
    expect(outbox.reset).toHaveLength(1);
    const link = new URL(outbox.reset[0].url);
    expect(link.pathname.startsWith(`${AUTH_BASE_PATH}/reset-password/`)).toBe(true);
    const token = link.pathname.split("/").pop() as string;
    expect(token.length).toBeGreaterThan(10);

    // DB 內是雜湊（不含明文 token），且約一小時
    const rows = await getDb().select().from(authVerifications);
    expect(rows.some((v) => v.identifier.includes(token))).toBe(false);
    const row = rows.find((v) => v.identifier.length === 43 || v.identifier.startsWith("reset-password"));
    expect(row).toBeDefined();
    const ttl = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 1000;
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);

    const newPassword = "another long password 2";
    const ok = await handleAuthRequest(req("/reset-password", { body: { token, newPassword } }));
    expect(ok.status).toBe(200);
    const again = await handleAuthRequest(req("/reset-password", { body: { token, newPassword: "yet another password 3" } }));
    expect(again.status).toBe(400);
    expect((await signIn("acc7-reset@example.com", PASSWORD)).status).toBe(401);
    expect((await signIn("acc7-reset@example.com", newPassword)).status).toBe(200);
  });

  it("不存在的信箱要求重設：同樣回成功、不寄信（不洩漏有沒有註冊）", async () => {
    outbox.reset.length = 0;
    const r = await handleAuthRequest(req("/request-password-reset", { body: { email: "acc7-ghost@example.com", redirectTo: "/zh-Hant/reset-password" } }));
    expect(r.status).toBe(200);
    expect(outbox.reset).toHaveLength(0);
  });

  it("placeholder 信箱的帳號：重設密碼不寄信；信箱不顯示", async () => {
    const ctx = await getAuth().$context;
    const user = await ctx.internalAdapter.createUser({ email: "7656119800acc7@steam.placeholder.invalid", name: "Steam Person", emailVerified: false }, undefined as never);
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "steam", accountId: "7656119800acc7" });
    outbox.reset.length = 0;
    await handleAuthRequest(req("/request-password-reset", { body: { email: "7656119800acc7@steam.placeholder.invalid", redirectTo: "/zh-Hant/reset-password" } }));
    expect(outbox.reset).toHaveLength(0);
    const linked = await listLinkedAccounts(Number(user.id));
    expect(linked.map((l) => l.provider)).toEqual(["steam"]);
  });

  it("刪除 users 列：connected_accounts、sessions 由 FK cascade 清除", async () => {
    const { cookie } = await signUp("acc7-cascade@example.com");
    expect(cookie).not.toBe("");
    const [u] = await getDb().select().from(users).where(eq(users.email, "acc7-cascade@example.com"));
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1);
    await getDb().delete(users).where(eq(users.id, u.id));
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
    expect(await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u.id))).toHaveLength(0);
  });

  it("解綁：只剩一個登入方式時被拒；有第二個時可解綁；已綁定清單排除 credential；OAuth token 加密落庫", async () => {
    const { cookie } = await signUp("acc7-unlink@example.com");
    const [u] = await getDb().select().from(users).where(eq(users.email, "acc7-unlink@example.com"));
    const [cred] = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.userId, u.id));

    const last = await handleAuthRequest(req("/unlink-account", { body: { accountId: String(cred.id) }, cookie }));
    expect(last.status).toBe(400);
    expect((await last.json()).code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");
    expect(await listLinkedAccounts(u.id)).toEqual([]); // credential 不算

    // 綁一個 discord（經 Better Auth 的 internalAdapter：會跑 databaseHooks 加密）
    const ctx = await getAuth().$context;
    await ctx.internalAdapter.createAccount({
      userId: String(u.id),
      providerId: "discord",
      accountId: "discord-acc7",
      accessToken: "AT-secret-value",
      refreshToken: "RT-secret-value",
      scope: "identify,email,guilds",
    });
    const [d] = await getDb().select().from(connectedAccounts).where(eq(connectedAccounts.provider, "discord"));
    const cipher = createTokenCipher(Buffer.from(KEY, "base64"));
    expect(d.accessToken).not.toContain("AT-secret-value");
    expect(cipher.decrypt(d.accessToken as string)).toBe("AT-secret-value");
    expect(cipher.decrypt(d.refreshToken as string)).toBe("RT-secret-value");
    expect(d.scope).toBe("identify,email,guilds");

    const linked = await listLinkedAccounts(u.id);
    expect(linked.map((l) => l.provider)).toEqual(["discord"]);

    // BA 的 list-accounts 會包含 credential（UI 端用 isExternalProvider 排除）
    const listed = await (await handleAuthRequest(req("/list-accounts", { cookie }))).json();
    expect((listed as { providerId: string }[]).map((a) => a.providerId).sort()).toEqual(["credential", "discord"]);

    const ok = await handleAuthRequest(req("/unlink-account", { body: { accountId: String(d.id) }, cookie }));
    expect(ok.status).toBe(200);
    expect(await listLinkedAccounts(u.id)).toEqual([]);
  });

  it("get-session：匿名回 null、不送 Set-Cookie；cookie cache 命中時登入者也不送 Set-Cookie", async () => {
    const anon = await handleAuthRequest(req("/get-session"));
    expect(anon.status).toBe(200);
    expect(await anon.json()).toBeNull();
    expect(anon.headers.getSetCookie()).toEqual([]);
    const { cookie } = await signUp("acc7-session@example.com");
    const me = await handleAuthRequest(req("/get-session", { cookie }));
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe("acc7-session@example.com");
    expect(me.headers.getSetCookie()).toEqual([]);
    expect(me.headers.get("cache-control")).toMatch(/no-store|private/);
  });

  it("不開放的端點（回傳 token 密文／帳號資訊）→ 404", async () => {
    const { cookie } = await signUp("acc7-blocked@example.com");
    for (const p of ["/get-access-token", "/refresh-token", "/account-info"]) {
      expect((await handleAuthRequest(req(p, { body: { providerId: "discord" }, cookie }))).status).toBe(404);
    }
  });

  it("每晚清理：刪過期的 session 與 auth_verifications，不動未過期的", async () => {
    const { cookie } = await signUp("acc7-cleanup@example.com");
    expect(cookie).not.toBe("");
    const [u] = await getDb().select().from(users).where(eq(users.email, "acc7-cleanup@example.com"));
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    await getDb().insert(sessions).values({ userId: u.id, token: "acc7-expired-token", expiresAt: past });
    await getDb().insert(authVerifications).values([
      { identifier: "acc7-expired", value: "v", expiresAt: past },
      { identifier: "acc7-live", value: "v", expiresAt: future },
    ]);
    const r = await cleanupExpiredAuthRows(new Date());
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.verifications).toBeGreaterThanOrEqual(1);
    expect(await getDb().select().from(sessions).where(eq(sessions.token, "acc7-expired-token"))).toHaveLength(0);
    expect(await getDb().select().from(authVerifications).where(eq(authVerifications.identifier, "acc7-live"))).toHaveLength(1);
    expect(await getDb().select().from(authVerifications).where(eq(authVerifications.identifier, "acc7-expired"))).toHaveLength(0);
    // 該使用者目前的有效 session 還在
    expect((await getDb().select().from(sessions).where(eq(sessions.userId, u.id))).length).toBeGreaterThanOrEqual(1);
  });

  it("限流：登入端點超過上限回 429（需要客戶端 IP；以 cf-connecting-ip）", async () => {
    const auth = createAuth({
      env: parseAccountsEnv({ AUTH_SECRET: SECRET, TOKEN_ENCRYPTION_KEY: KEY, NEXT_PUBLIC_SITE_URL: ORIGIN, ACCOUNTS_SIGNUP_ENABLED: "true", NODE_ENV: "test" }),
      database: createAuthDatabaseAdapter(),
      mailer: createLogMailer(() => {}),
      rateLimitEnabled: true,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await auth.handler(
        new Request(url("/sign-in/email"), {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.77" },
          body: JSON.stringify({ email: "acc7-rate@example.com", password: "whatever password" }),
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("註冊關閉：路由 404、直接呼叫被拒、不建立使用者；既有帳號仍可登入；社群 provider 也設為不可註冊", async () => {
    await signUp("acc7-existing@example.com");
    setEnv(false);
    const before = (await getDb().select().from(users).where(like(users.email, "acc7-%"))).length;

    const viaRoute = await handleAuthRequest(req("/sign-up/email", { body: { email: "acc7-closed@example.com", password: PASSWORD, name: "Closed" } }));
    expect(viaRoute.status).toBe(404);

    // 繞過路由、直接呼叫 Better Auth 也不行
    await expect(getAuth().api.signUpEmail({ body: { email: "acc7-closed2@example.com", password: PASSWORD, name: "Closed" } })).rejects.toBeDefined();
    const ctx = await getAuth().$context;
    // 底層 createUser 被 databaseHooks.user.create.before 取消（回傳 null，不寫入）
    expect(await ctx.internalAdapter.createUser({ email: "acc7-closed3@example.com", name: "Closed" }, undefined as never)).toBeNull();
    expect(await getDb().select().from(users).where(eq(users.email, "acc7-closed3@example.com"))).toHaveLength(0);

    expect(await getDb().select().from(users).where(eq(users.email, "acc7-closed@example.com"))).toHaveLength(0);
    expect(await getDb().select().from(users).where(eq(users.email, "acc7-closed2@example.com"))).toHaveLength(0);
    expect((await getDb().select().from(users).where(like(users.email, "acc7-%"))).length).toBe(before);

    // 既有帳號仍可登入
    const login = await signIn("acc7-existing@example.com");
    expect(login.status).toBe(200);
    expect(cookieOf(login)).toContain("session_token");
    setEnv(true);
  });
});
