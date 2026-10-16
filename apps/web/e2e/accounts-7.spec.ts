/**
 * Phase 7 第 1 波：accounts（Better Auth＋Email 密碼）。
 * - 登入／註冊／忘記密碼／重設密碼／帳號頁：三語 axe（桌機、375、320 無水平溢出）。
 * - 測試帳號登入 → header 顯示名稱 → 登出；錯誤密碼的提示；placeholder 信箱不顯示。
 * - 可快取頁面：登入後回應仍無 Set-Cookie、HTML 不含使用者名稱與信箱（登入狀態由客戶端取得）。
 * - 註冊關閉（ACCOUNTS_SIGNUP_ENABLED=false）：另外啟動第二個伺服器（同一份建置、同一個資料庫）驗證：
 *   無註冊入口、/signup 軟 404、POST sign-up 404、既有帳號仍可登入。
 * e2e 伺服器的 AUTH_SECRET／TOKEN_ENCRYPTION_KEY／ACCOUNTS_SIGNUP_ENABLED=true 在 e2e/support/env.ts。
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { E2E_BASE_URL, E2E_CLOSED_BASE_URL, E2E_CLOSED_PORT, WEB_DIR, serverEnv, testDatabaseUrl } from "./support/env";
import { FIXTURE, LOCALES, calendarUrl, expect, expectNoA11yViolations, gameUrl, msg, test, type TestLocale } from "./support/helpers";
import { request as pwRequest, type Page } from "@playwright/test";

const PASSWORD = "e2e long password 1";
const RUN = Date.now().toString(36);
const uniqueEmail = (tag: string) => `e2e-${tag}-${RUN}@example.com`;
const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);

/** 以獨立的 request context 註冊（它的 Cookie 不影響測試用的 request／page）。 */
async function register(baseURL: string, email: string, name: string): Promise<void> {
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.post(`${baseURL}/api/v1/auth/sign-up/email`, { headers: { origin: baseURL }, data: { email, password: PASSWORD, name } });
    expect(res.status(), `註冊 ${email}`).toBe(200);
  } finally {
    await ctx.dispose();
  }
}

async function login(page: Page, locale: TestLocale, email: string, password = PASSWORD): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(m(locale, "common.email")).fill(email);
  await page.getByLabel(m(locale, "common.password")).fill(password);
  await page.getByRole("button", { name: m(locale, "login.submit"), exact: true }).click();
}

const header = (page: Page) => page.getByRole("banner");

test.describe("頁面無障礙（三語；桌機、375、320）", () => {
  const pages: { path: string; heading: (l: TestLocale) => string; skipNote?: string }[] = [
    { path: "login", heading: (l) => m(l, "login.title") },
    { path: "signup", heading: (l) => m(l, "signup.title") },
    { path: "forgot-password", heading: (l) => m(l, "forgot.title") },
    { path: "reset-password?token=e2e-token", heading: (l) => m(l, "reset.title") },
    { path: "reset-password?error=INVALID_TOKEN", heading: (l) => m(l, "reset.title") },
    { path: "account", heading: (l) => m(l, "account.title") },
  ];
  for (const locale of LOCALES) {
    for (const p of pages) {
      for (const width of [1280, 375, 320]) {
        test(`${locale} /${p.path} 寬 ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`/${locale}/${p.path}`);
          await expect(page.getByRole("heading", { level: 1, name: p.heading(locale) })).toBeVisible();
          // 帳號頁匿名狀態要等客戶端取得 session 後再量
          if (p.path === "account") await expect(page.getByRole("heading", { name: m(locale, "account.signedOutTitle") })).toBeVisible();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `${width} 寬不可水平捲動（溢出 ${overflow}px）`).toBeLessThanOrEqual(0);
          await expectNoA11yViolations(page, `${locale} /${p.path} ${width}`);
        });
      }
    }
  }

  test("頁面 noindex、不快取（private/no-store）、不送 Set-Cookie", async ({ request }) => {
    for (const p of ["login", "signup", "forgot-password", "reset-password", "account"]) {
      const res = await request.get(`/zh-Hant/${p}`);
      expect(res.status(), p).toBe(200);
      expect(res.headers()["set-cookie"], p).toBeUndefined();
      expect(res.headers()["cache-control"], p).toMatch(/no-store|private/);
      expect(await res.text(), p).toMatch(/<meta name="robots" content="noindex/);
    }
  });

  test("不進 sitemap", async ({ request }) => {
    const body = await (await request.get("/sitemap/pages.xml")).text();
    for (const p of ["login", "signup", "forgot-password", "reset-password", "/account"]) expect(body).not.toContain(p);
  });
});

test.describe("登入流程", () => {
  test("註冊的測試帳號：登入 → header 顯示名稱 → 登出（三語）", async ({ page }) => {
    for (const locale of LOCALES) {
      const name = `E2E 測試者 ${locale}`;
      const email = uniqueEmail(`flow-${locale}`);
      await register(E2E_BASE_URL, email, name);
      await page.context().clearCookies();

      await page.goto(`/${locale}/login`);
      // 載入完成後 header 顯示「登入」連結（未登入）
      await expect(header(page).getByRole("link", { name: m(locale, "header.signIn") })).toBeVisible();

      await login(page, locale, email);
      await page.waitForURL(`**/${locale}/calendar**`);
      const menuButton = header(page).getByRole("button", { name: m(locale, "header.menu", { name }) });
      await expect(menuButton).toBeVisible();
      await expect(menuButton).toContainText(name);
      await expect(header(page).getByRole("link", { name: m(locale, "header.signIn") })).toHaveCount(0);

      // 選單：我的帳號、登出；Escape 關閉
      await menuButton.click();
      await expect(menuButton).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(menuButton).toHaveAttribute("aria-expanded", "false");
      await menuButton.click();
      await header(page).getByRole("button", { name: m(locale, "header.signOut") }).click();
      await expect(header(page).getByRole("link", { name: m(locale, "header.signIn") })).toBeVisible();
      await expect(header(page).getByRole("button", { name: m(locale, "header.menu", { name }) })).toHaveCount(0);
    }
  });

  test("錯誤密碼：顯示錯誤、留在登入頁、不登入", async ({ page }) => {
    const email = uniqueEmail("wrongpw");
    await register(E2E_BASE_URL, email, "Wrong Pw");
    await page.context().clearCookies();
    await login(page, "en", email, "definitely wrong password");
    await expect(page.locator("main").getByRole("alert")).toHaveText(m("en", "login.error.invalid"));
    await expect(page).toHaveURL(/\/en\/login$/);
    await expect(header(page).getByRole("link", { name: m("en", "header.signIn") })).toBeVisible();
  });

  test("註冊表單：密碼太短 → 欄位錯誤；成功 → 自動登入並回到月曆", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await page.goto(`/${locale}/signup`);
    await page.getByLabel(m(locale, "common.displayName")).fill("表單註冊者");
    await page.getByLabel(m(locale, "common.email")).fill(uniqueEmail("signup-form"));
    await page.getByLabel(m(locale, "common.password")).fill("short");
    await page.getByRole("button", { name: m(locale, "signup.submit") }).click();
    await expect(page.getByText(m(locale, "signup.error.passwordTooShort", { min: 10 }))).toBeVisible();
    await page.getByLabel(m(locale, "common.password")).fill(PASSWORD);
    await page.getByRole("button", { name: m(locale, "signup.submit") }).click();
    await page.waitForURL(`**/${locale}/calendar**`);
    await expect(header(page).getByRole("button", { name: m(locale, "header.menu", { name: "表單註冊者" }) })).toBeVisible();
  });

  test("忘記密碼：任何信箱都回「已受理」（不洩漏是否註冊）", async ({ page }) => {
    const locale: TestLocale = "en";
    await page.goto(`/${locale}/forgot-password`);
    await page.getByLabel(m(locale, "common.email")).fill(uniqueEmail("nobody"));
    await page.getByRole("button", { name: m(locale, "forgot.submit") }).click();
    await expect(page.getByRole("status")).toHaveText(m(locale, "forgot.sent"));
  });

  test("帳號頁：顯示名稱與信箱、不列出 credential、解綁區只有說明", async ({ page }) => {
    const locale: TestLocale = "ja";
    const email = uniqueEmail("account");
    await register(E2E_BASE_URL, email, "アカウント太郎");
    await page.context().clearCookies();
    await login(page, locale, email);
    await page.waitForURL(`**/${locale}/calendar**`);
    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId("account-name")).toHaveText("アカウント太郎");
    await expect(page.getByTestId("account-email")).toContainText(email);
    await expect(page.getByText(m(locale, "account.linkedNone"))).toBeVisible();
    await expect(page.getByText(m(locale, "providers.credential"))).toHaveCount(0);
    await expectNoA11yViolations(page, "ja /account 已登入");
    await page.getByRole("button", { name: m(locale, "account.signOut") }).click();
    await page.waitForURL(`**/${locale}/login`);
  });

  test("placeholder 信箱的帳號：帳號頁不顯示信箱", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    const email = `7656119800${RUN}@steam.placeholder.invalid`;
    await register(E2E_BASE_URL, email, "Steam 玩家");
    await page.context().clearCookies();
    await login(page, locale, email);
    await page.waitForURL(`**/${locale}/calendar**`);
    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId("account-name")).toHaveText("Steam 玩家");
    await expect(page.getByTestId("account-email")).toHaveText(m(locale, "account.emailNone"));
    expect(await page.content()).not.toContain("placeholder.invalid");
  });
});

test.describe("可快取頁面不含使用者資訊", () => {
  test("登入後：月曆、詳情、時間軸、瀏覽頁回應無 Set-Cookie、HTML 不含名稱與信箱；cache-control 不變", async ({ page, request }) => {
    const locale: TestLocale = "zh-Hant";
    const name = "快取檢查員";
    const email = uniqueEmail("cache");
    await register(E2E_BASE_URL, email, name);
    await page.context().clearCookies();
    await login(page, locale, email);
    await page.waitForURL(`**/${locale}/calendar**`);
    await expect(header(page).getByRole("button", { name: m(locale, "header.menu", { name }) })).toBeVisible();

    const urls = [calendarUrl(locale, FIXTURE.month), gameUrl(locale, FIXTURE.hero.slug), `/${locale}/timeline`, `/${locale}/games`, `/${locale}/platforms`];
    for (const u of urls) {
      // page.request 與瀏覽器共用 Cookie（帶著登入狀態）
      const authed = await page.request.get(u);
      const anon = await request.get(u);
      expect(authed.status(), u).toBe(200);
      expect(authed.headers()["set-cookie"], `${u} 不可送 Set-Cookie`).toBeUndefined();
      const html = await authed.text();
      expect(html, `${u} 不可含使用者名稱`).not.toContain(name);
      expect(html, `${u} 不可含信箱`).not.toContain(email);
      expect(authed.headers()["cache-control"], `${u} cache-control 與匿名相同`).toBe(anon.headers()["cache-control"]);
      // header 只有靜態的載入中外殼
      expect(html).toContain('data-account-slot="loading"');
    }
  });

  test("Set-Cookie 只出現在 /api/v1/auth/*：登入端點有、get-session（cookie cache 命中）沒有", async ({ request }) => {
    const email = uniqueEmail("cookies");
    const res = await request.post("/api/v1/auth/sign-up/email", { headers: { origin: E2E_BASE_URL }, data: { email, password: PASSWORD, name: "Cookie 檢查" } });
    expect(res.status()).toBe(200);
    expect(res.headers()["set-cookie"]).toContain("session_token");
    const session = await request.get("/api/v1/auth/get-session");
    expect(session.status()).toBe(200);
    expect((await session.json()).user.email).toBe(email);
    expect(session.headers()["set-cookie"]).toBeUndefined();
    expect(session.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("註冊關閉（ACCOUNTS_SIGNUP_ENABLED=false；第二個伺服器）", () => {
  test.describe.configure({ mode: "serial" });
  let server: ChildProcess | undefined;
  const closedEmail = uniqueEmail("closed-existing");

  test.beforeAll(async () => {
    // 先在開放註冊的主伺服器建立一個既有帳號（同一個資料庫）
    await register(E2E_BASE_URL, closedEmail, "既有帳號");
    const nextBin = require.resolve("next/dist/bin/next", { paths: [WEB_DIR] });
    server = spawn(process.execPath, [nextBin, "start", "-p", String(E2E_CLOSED_PORT)], {
      cwd: path.resolve(WEB_DIR),
      env: { ...serverEnv(), ACCOUNTS_SIGNUP_ENABLED: "false", PORT: String(E2E_CLOSED_PORT) },
      stdio: "ignore",
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(`${E2E_CLOSED_BASE_URL}/healthz`)).ok) break;
      } catch {
        // 還沒起來
      }
      if (Date.now() > deadline) throw new Error("註冊關閉的伺服器沒有在 60 秒內啟動");
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  test.afterAll(() => {
    server?.kill();
  });

  test("登入頁沒有註冊入口；header 與登入頁都找不到指向 /signup 的連結", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`${E2E_CLOSED_BASE_URL}/${locale}/login`);
      await expect(page.getByRole("heading", { level: 1, name: m(locale, "login.title") })).toBeVisible();
      await expect(page.locator('a[href$="/signup"]')).toHaveCount(0);
      await expect(page.getByText(m(locale, "login.signupLink"))).toHaveCount(0);
    }
  });

  test("/signup 是軟 404（找不到頁面、noindex、沒有表單）", async ({ page }) => {
    await page.goto(`${E2E_CLOSED_BASE_URL}/en/signup`);
    await expect(page.getByRole("heading", { name: msg("en", "errors.notFound.title") })).toBeVisible();
    await expect(page.getByLabel(m("en", "common.displayName"))).toHaveCount(0);
    expect(await page.content()).toContain('name="robots" content="noindex');
  });

  test("POST /api/v1/auth/sign-up/email → 404，且不建立使用者", async ({ request }) => {
    const email = uniqueEmail("closed-new");
    const res = await request.post(`${E2E_CLOSED_BASE_URL}/api/v1/auth/sign-up/email`, {
      headers: { origin: E2E_CLOSED_BASE_URL },
      data: { email, password: PASSWORD, name: "Closed" },
    });
    expect(res.status()).toBe(404);
    // 用該信箱登入也不會成功
    const login = await request.post(`${E2E_CLOSED_BASE_URL}/api/v1/auth/sign-in/email`, { headers: { origin: E2E_CLOSED_BASE_URL }, data: { email, password: PASSWORD } });
    expect(login.status()).toBe(401);
  });

  test("既有帳號仍可登入並登出", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await page.goto(`${E2E_CLOSED_BASE_URL}/${locale}/login`);
    await page.getByLabel(m(locale, "common.email")).fill(closedEmail);
    await page.getByLabel(m(locale, "common.password")).fill(PASSWORD);
    await page.getByRole("button", { name: m(locale, "login.submit"), exact: true }).click();
    await page.waitForURL(`**/${locale}/calendar**`);
    await expect(header(page).getByRole("button", { name: m(locale, "header.menu", { name: "既有帳號" }) })).toBeVisible();
  });
});

// ── 第 3 波：Steam 登入按鈕與遊戲庫區 ─────────────────────────────────────────
let steamSeq = 0;
/** 為已註冊的信箱建立 Steam 綁定與 owned_games（直接寫測試資料庫；不連 Steam）。 */
async function seedSteamLibrary(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const steamId = `76561199${(Date.now() % 100_000_000).toString().padStart(8, "0")}${steamSeq++ % 10}`;
    const { rows: u } = await client.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    const { rows: a } = await client.query<{ id: number }>(
      "INSERT INTO connected_accounts (user_id, provider, provider_account_id) VALUES ($1, 'steam', $2) RETURNING id",
      [u[0]!.id, steamId],
    );
    const { rows: g } = await client.query<{ id: number }>("SELECT id FROM games WHERE slug = $1", [FIXTURE.hero.slug]);
    const acct = a[0]!.id;
    const insert = (appId: string, title: string, gameId: number | null, pct: number | null) =>
      client.query(
        "INSERT INTO owned_games (connected_account_id, external_game_id, external_title, matched_game_id, match_confidence_pct) VALUES ($1,$2,$3,$4,$5)",
        [acct, appId, title, gameId, pct],
      );
    await insert("1001", "Aurora Odyssey (Steam)", g[0]!.id, 100);
    await insert("1002", "Borderline Title", null, 70);
    await insert("1003", "Nowhere Title", null, 0);
    await insert("1004", "Waiting Title", null, null);
    for (let i = 0; i < 55; i++) await insert(String(2000 + i), `Filler Game ${String(i).padStart(2, "0")}`, null, 0);
  } finally {
    await client.end();
  }
}

test.describe("Steam（第 3 波）", () => {
  test("登入頁有「用 Steam 登入」按鈕（三語）；點下去會取得 Steam 授權網址並導向（攔截，不連 Steam）", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.route("https://steamcommunity.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>steam</title>" }));
      await page.goto(`/${locale}/login`);
      const button = page.getByRole("button", { name: m(locale, "common.continueWith", { provider: "Steam" }) });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
      await page.waitForURL("https://steamcommunity.com/openid/login**");
      const u = new URL(page.url());
      expect(u.searchParams.get("openid.mode")).toBe("checkid_setup");
      expect(u.searchParams.get("openid.return_to")).toContain("/api/v1/auth/steam/callback?n=");
      await page.unroute("https://steamcommunity.com/**");
    }
  });

  test("?error= 的 Steam 錯誤碼在登入頁顯示對應文案（三語）", async ({ page }) => {
    const codes: [string, string][] = [
      ["steam_invalid_response", "login.error.steamInvalid"],
      ["steam_verification_failed", "login.error.steamVerification"],
      ["steam_already_linked", "login.error.steamAlreadyLinked"],
      ["steam_network_error", "login.error.steamNetwork"],
      ["signup_disabled", "login.error.signupDisabled"],
    ];
    for (const locale of LOCALES) {
      for (const [code, key] of codes) {
        await page.goto(`/${locale}/login?error=${code}`);
        await expect(page.locator("main").getByRole("alert")).toHaveText(m(locale, key));
      }
    }
  });

  test("匿名請求 POST／GET /api/v1/imports/steam → 401（no-store）；不支援的平台 → 404；Origin 不符 → 403", async ({ request }) => {
    const post = await request.post("/api/v1/imports/steam", { headers: { origin: E2E_BASE_URL } });
    expect(post.status()).toBe(401);
    expect(post.headers()["cache-control"]).toBe("no-store");
    expect((await request.get("/api/v1/imports/steam")).status()).toBe(401);
    expect((await request.post("/api/v1/imports/xbox", { headers: { origin: E2E_BASE_URL } })).status()).toBe(404);
    expect((await request.post("/api/v1/imports/steam", { headers: { origin: "https://evil.example" } })).status()).toBe(403);
  });

  for (const locale of LOCALES) {
    test(`${locale} 帳號頁：Steam 遊戲庫區（提示、停用的匯入鈕與原因、摘要、清單、顯示更多）；三種寬度 axe 與無水平溢出`, async ({ page }) => {
      const email = uniqueEmail(`steam-lib-${locale}`);
      await register(E2E_BASE_URL, email, `Steam ${locale}`);
      await seedSteamLibrary(email);
      await page.context().clearCookies();
      await login(page, locale, email);
      await page.waitForURL(`**/${locale}/calendar**`);
      for (const width of [1280, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}/account`);
        await expect(page.getByRole("heading", { level: 2, name: m(locale, "steam.title") })).toBeVisible();
        await expect(page.getByText(m(locale, "steam.privacyNote"))).toBeVisible();
        await expect(page.getByText(m(locale, "steam.privacyHow"))).toBeVisible();
        // e2e 伺服器沒有 STEAM_WEB_API_KEY：匯入鈕停用並說明原因
        const importButton = page.getByRole("button", { name: m(locale, "steam.reimport") });
        await expect(importButton).toBeDisabled();
        await expect(page.getByText(m(locale, "steam.unavailable"))).toBeVisible();
        await expect(page.getByTestId("steam-summary")).toContainText(m(locale, "steam.summary", { total: "59", matched: "1", review: "1", notFound: "56" }));
        // 已比對的遊戲連到詳情頁；其他狀態顯示文字
        await expect(page.getByRole("link", { name: FIXTURE.hero.name })).toHaveAttribute("href", `/${locale}/games/${FIXTURE.hero.slug}`);
        await expect(page.getByText(m(locale, "steam.status.needs_review"), { exact: true })).toBeVisible();
        await expect(page.getByRole("list", { name: m(locale, "steam.listLabel") }).getByRole("listitem")).toHaveCount(50);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const offenders = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map((e) => e.tagName + "." + e.className + " " + (e.textContent ?? "").slice(0, 30)).slice(0, 8));
        expect(overflow, `${width} 寬不可水平捲動（溢出 ${overflow}px）${JSON.stringify(offenders)}`).toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} /account Steam ${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: m(locale, "steam.showMore") }).click();
      await expect(page.getByRole("list", { name: m(locale, "steam.listLabel") }).getByRole("listitem")).toHaveCount(59);
      await expect(page.getByRole("button", { name: m(locale, "steam.showMore") })).toHaveCount(0);
    });
  }

  test("沒綁 Steam 的帳號：帳號頁有「綁定 Steam」，沒有遊戲庫區；GET／POST /api/v1/imports/steam → 409", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = uniqueEmail("steam-none");
    await register(E2E_BASE_URL, email, "No Steam");
    await page.context().clearCookies();
    await login(page, locale, email);
    await page.waitForURL(`**/${locale}/calendar**`);
    await page.goto(`/${locale}/account`);
    await expect(page.getByRole("button", { name: m(locale, "account.linkSteam") })).toBeVisible();
    await expect(page.getByRole("heading", { name: m(locale, "steam.title") })).toHaveCount(0);
    expect((await page.request.get("/api/v1/imports/steam")).status()).toBe(409);
    expect((await page.request.post("/api/v1/imports/steam", { headers: { origin: E2E_BASE_URL } })).status()).toBe(409);
  });
});
