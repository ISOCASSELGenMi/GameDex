/**
 * Phase 7 第 7 波畫面：帳號設定、隱私與資料（匯出下載、刪除帳號）、刪除完成頁、/internal/users 停權。
 * 登入用 API（快）；資料用 API 或直接寫測試資料庫。每個測試用自己的帳號。
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_BASE_URL } from "./support/env";
import { LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";
import { api, apiLogin, horizontalOverflow, register, signedInUser, uniqueEmail, userIdByEmail, withDb } from "./support/accounts";

const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);
const PASSWORD = "e2e long password 1";
const adminAuth = { httpCredentials: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } };

async function openSettings(page: Page, locale: TestLocale): Promise<void> {
  await page.goto(`/${locale}/account/settings`);
  await expect(page.getByRole("heading", { level: 1, name: m(locale, "settings.title") })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: m(locale, "settings.formTitle") })).toBeVisible();
}

async function openPrivacy(page: Page, locale: TestLocale): Promise<void> {
  await page.goto(`/${locale}/account/privacy`);
  await expect(page.getByRole("heading", { level: 1, name: m(locale, "privacy.title") })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: m(locale, "privacy.delete.title") })).toBeVisible();
}

test.describe("帳號首頁入口", () => {
  test("有設定、隱私與資料的連結", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "home7");
    await page.goto(`/${locale}/account`);
    const settings = page.getByRole("link", { name: m(locale, "settings.nav.settings"), exact: true });
    await expect(settings).toHaveAttribute("href", `/${locale}/account/settings`);
    await expect(page.getByRole("link", { name: m(locale, "settings.nav.privacy"), exact: true })).toHaveAttribute("href", `/${locale}/account/privacy`);
    await settings.click();
    await page.waitForURL(`**/${locale}/account/settings`);
  });
});

test.describe("未登入", () => {
  for (const path of ["settings", "privacy"]) {
    test(`/account/${path} 顯示登入提示（伺服器 HTML 與使用者無關）`, async ({ page, request }) => {
      const locale: TestLocale = "zh-Hant";
      const html = await (await request.get(`/${locale}/account/${path}`)).text();
      expect(html).not.toContain('data-section="account-settings"');
      expect(html).not.toContain('data-section="danger-zone"');
      await page.goto(`/${locale}/account/${path}`);
      await expect(page.getByRole("heading", { name: m(locale, "account.signedOutTitle") })).toBeVisible();
    });
  }
  test("刪除完成頁不需登入", async ({ page }) => {
    await page.goto("/en/account/deleted");
    await expect(page.getByTestId("account-deleted")).toHaveText(m("en", "privacy.deleted.body"));
  });
});

test.describe("帳號設定", () => {
  test("儲存偏好 → 重新整理仍在 → 後端一致；沒有變更顯示「沒有變更」", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "prefs7", "設定測試者");
    await openSettings(page, locale);

    await page.getByLabel(m(locale, "settings.displayName"), { exact: true }).fill("新的顯示名稱");
    await page.getByLabel(m(locale, "settings.locale"), { exact: true }).selectOption("ja");
    await page.getByLabel(m(locale, "settings.timezone"), { exact: true }).fill("Asia/Tokyo");
    const region = page.getByLabel(m(locale, "settings.region"), { exact: true });
    const regionValue = await region.locator("option").nth(1).getAttribute("value");
    expect(regionValue, "fixture 要有地區").toBeTruthy();
    await region.selectOption(regionValue!);
    await page.getByLabel(m(locale, "settings.scoresCustom"), { exact: true }).check();
    await page.getByLabel(m(locale, "settings.scoreProvider.igdb"), { exact: true }).check();
    const platforms = page.getByRole("group", { name: m(locale, "settings.platforms") });
    await platforms.locator("summary").first().click();
    const firstPlatform = platforms.getByRole("checkbox").first();
    await firstPlatform.check();
    const platformName = (await firstPlatform.evaluate((el) => (el.closest("label") as HTMLLabelElement).innerText)).trim();
    await page.getByLabel(m(locale, "settings.defaultListVisibility"), { exact: true }).selectOption("public");
    await page.getByLabel(m(locale, "settings.defaultReviewVisibility"), { exact: true }).selectOption("private");
    await page.getByRole("button", { name: m(locale, "settings.save"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "settings.saved") })).toBeVisible();

    const saved = await api<{ preferences: Record<string, unknown> }>(page, "GET", "/api/v1/account/preferences");
    expect(saved.json.preferences).toMatchObject({
      displayName: "新的顯示名稱",
      locale: "ja",
      timezone: "Asia/Tokyo",
      preferredRegion: regionValue,
      scoreProviders: ["igdb"],
      defaultListVisibility: "public",
      defaultReviewVisibility: "private",
    });
    expect((saved.json.preferences.preferredPlatformIds as number[]).length).toBe(1);

    await page.reload();
    await expect(page.getByLabel(m(locale, "settings.displayName"), { exact: true })).toHaveValue("新的顯示名稱");
    await expect(page.getByLabel(m(locale, "settings.locale"), { exact: true })).toHaveValue("ja");
    await expect(page.getByLabel(m(locale, "settings.timezone"), { exact: true })).toHaveValue("Asia/Tokyo");
    await expect(page.getByLabel(m(locale, "settings.region"), { exact: true })).toHaveValue(regionValue!);
    await expect(page.getByLabel(m(locale, "settings.scoresCustom"), { exact: true })).toBeChecked();
    await expect(page.getByLabel(m(locale, "settings.scoreProvider.igdb"), { exact: true })).toBeChecked();
    await expect(page.getByRole("group", { name: m(locale, "settings.platforms") }).getByRole("checkbox", { name: platformName, exact: true })).toBeChecked();
    await expect(page.getByLabel(m(locale, "settings.defaultListVisibility"), { exact: true })).toHaveValue("public");
    await expect(page.getByLabel(m(locale, "settings.defaultReviewVisibility"), { exact: true })).toHaveValue("private");

    // 再按一次儲存：沒有變更
    await page.getByRole("button", { name: m(locale, "settings.save"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "settings.unchanged") })).toBeVisible();

    // 預設可見度實際生效：新清單沒指定可見度 → public
    const list = await api<{ list: { visibility: string } }>(page, "POST", "/api/v1/lists", { name: "預設可見度" });
    expect(list.json.list.visibility).toBe("public");
  });

  test("時區無效 → 欄位錯誤（伺服器驗證）；顯示名稱留空 → 必填", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "prefs7-err");
    await openSettings(page, locale);
    await page.getByLabel(m(locale, "settings.timezone"), { exact: true }).fill("UTC+8");
    await page.getByRole("button", { name: m(locale, "settings.save"), exact: true }).click();
    await expect(page.getByText(m(locale, "error.field.invalid"))).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: m(locale, "error.summary") })).toBeVisible();
    await page.getByLabel(m(locale, "settings.timezone"), { exact: true }).fill("");
    await page.getByLabel(m(locale, "settings.displayName"), { exact: true }).fill("   ");
    await page.getByRole("button", { name: m(locale, "settings.save"), exact: true }).click();
    await expect(page.getByText(m(locale, "error.field.required"))).toBeVisible();
  });

  for (const locale of LOCALES) {
    for (const width of [1280, 320]) {
      test(`${locale} 寬 ${width}：axe 無違規、無水平溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await signedInUser(page, `a11y-settings-${locale}-${width}`);
        await openSettings(page, locale);
        await expectNoA11yViolations(page, `設定頁 ${locale} ${width}`);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe("資料匯出", () => {
  test("JSON 下載：檔名、內容含本人資料、不含密碼與 feed token", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    const email = await signedInUser(page, "export7", "匯出測試者");
    await api(page, "POST", "/api/v1/lists", { name: "匯出清單" });
    const feed = await api<{ feed: { url: string } }>(page, "GET", "/api/v1/calendar/feeds");
    const token = /\/ical\/u\/([A-Za-z0-9_-]+)\.ics/.exec(feed.json.feed.url)![1]!;
    await openPrivacy(page, locale);

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-export="json"]').click()]);
    expect(download.suggestedFilename()).toMatch(/^sok-export-\d{4}-\d{2}-\d{2}\.json$/);
    const text = readFileSync((await download.path())!, "utf8");
    const data = JSON.parse(text) as { profile: { email: string; displayName: string }; lists: { name: string }[] };
    expect(data.profile).toMatchObject({ email: email.toLowerCase(), displayName: "匯出測試者" });
    expect(data.lists.map((l) => l.name)).toEqual(["匯出清單"]);
    expect(text).not.toContain(token);
    expect(text).not.toContain("$argon2");
    await expect(page.getByRole("status").filter({ hasText: download.suggestedFilename() })).toBeVisible();
  });

  test("CSV 分段下載：有 BOM、公式防護", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "export7-csv");
    await api(page, "POST", "/api/v1/lists", { name: "=1+1" });
    await openPrivacy(page, locale);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-export="csv-lists"]').click()]);
    expect(download.suggestedFilename()).toMatch(/^sok-lists-\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = readFileSync((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    expect(text).toContain("'=1+1");
    expect(text).not.toMatch(/(^|,)=1\+1/m);
  });

  test("匯出次數超過每小時上限 → 頁面顯示說明", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "export7-rate");
    // 先用 API 把額度用完（每小時 12 次）
    for (let i = 0; i < 12; i++) expect((await page.request.get("/api/v1/account/export?format=csv&part=profile")).status()).toBe(200);
    await openPrivacy(page, locale);
    await page.locator('[data-export="json"]').click();
    await expect(page.getByText(m(locale, "privacy.export.rateLimited"))).toBeVisible();
  });
});

test.describe("隱私與資料頁", () => {
  for (const locale of LOCALES) {
    for (const width of [1280, 320]) {
      test(`${locale} 寬 ${width}：axe 無違規、無水平溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await signedInUser(page, `a11y-privacy-${locale}-${width}`);
        await openPrivacy(page, locale);
        await expectNoA11yViolations(page, `隱私與資料頁 ${locale} ${width}`);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe("刪除帳號", () => {
  test("有密碼：未勾選時按鈕停用；密碼錯誤顯示錯誤；正確則刪除、導到完成頁、舊 session 與私人行事曆網址失效", async ({ page, request }) => {
    const locale: TestLocale = "zh-Hant";
    const email = await signedInUser(page, "delete7", "要被刪除的人");
    const userId = await userIdByEmail(email);
    await api(page, "POST", "/api/v1/lists", { name: "將被刪除的清單" });
    const feed = await api<{ feed: { url: string } }>(page, "GET", "/api/v1/calendar/feeds");
    const feedPath = new URL(feed.json.feed.url).pathname;
    expect((await request.get(feedPath)).status()).toBe(200);

    await openPrivacy(page, locale);
    const danger = page.locator('[data-section="danger-zone"]');
    const startButton = danger.getByRole("button", { name: m(locale, "privacy.delete.button"), exact: true });
    await expect(startButton).toBeDisabled();
    await danger.getByLabel(m(locale, "privacy.delete.ack"), { exact: true }).check();
    await expect(startButton).toBeEnabled();

    // 沒輸入密碼
    await startButton.click();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.confirmButton"), exact: true }).click();
    await expect(danger.getByText(m(locale, "privacy.delete.passwordRequired"))).toBeVisible();

    // 密碼錯誤
    await danger.getByLabel(m(locale, "privacy.delete.password"), { exact: true }).fill("wrong password!");
    await startButton.click();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.confirmButton"), exact: true }).click();
    await expect(danger.getByText(m(locale, "privacy.delete.wrongPassword"))).toBeVisible();
    expect(await withDb(async (c) => (await c.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount)).toBe(1);

    // 取消確認不會刪
    await startButton.click();
    await danger.getByRole("button", { name: m(locale, "common.cancel"), exact: true }).click();
    await expect(startButton).toBeVisible();

    // 正確密碼
    await danger.getByLabel(m(locale, "privacy.delete.password"), { exact: true }).fill(PASSWORD);
    await startButton.click();
    await expect(danger.getByText(m(locale, "privacy.delete.confirm"))).toBeVisible();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.confirmButton"), exact: true }).click();
    await page.waitForURL(`**/${locale}/account/deleted`);
    await expect(page.getByTestId("account-deleted")).toHaveText(m(locale, "privacy.deleted.body"));
    await expectNoA11yViolations(page, "刪除完成頁");

    // 資料庫：使用者、清單、feed、session 都清空
    const counts = await withDb(async (c) => {
      const one = async (sql: string) => Number((await c.query<{ n: string }>(sql, [userId])).rows[0]!.n);
      return {
        users: await one("SELECT count(*) AS n FROM users WHERE id = $1"),
        lists: await one("SELECT count(*) AS n FROM user_lists WHERE user_id = $1"),
        feeds: await one("SELECT count(*) AS n FROM calendar_feeds WHERE user_id = $1"),
        sessions: await one("SELECT count(*) AS n FROM sessions WHERE user_id = $1"),
        connected: await one("SELECT count(*) AS n FROM connected_accounts WHERE user_id = $1"),
      };
    });
    expect(counts).toEqual({ users: 0, lists: 0, feeds: 0, sessions: 0, connected: 0 });

    // 私人行事曆網址 404；原本的瀏覽器已登出；不能再登入
    expect((await request.get(feedPath)).status()).toBe(404);
    const session = await page.request.get("/api/v1/auth/get-session");
    expect(await session.json()).toBeNull();
    const again = await page.request.post("/api/v1/auth/sign-in/email", { headers: { origin: E2E_BASE_URL }, data: { email, password: PASSWORD } });
    expect(again.status()).toBe(401);
    await page.goto(`/${locale}/account/privacy`);
    await expect(page.getByRole("heading", { name: m(locale, "account.signedOutTitle") })).toBeVisible();
  });

  /** 註冊並用密碼登入後，把帳號改成「只有社群登入」（沒有 credential 列）。session 建立時間可指定。 */
  async function socialOnlyUser(page: Page, tag: string, sessionAgeMinutes: number): Promise<number> {
    const email = uniqueEmail(tag);
    await register(email, "No Password");
    await apiLogin(page, email);
    const userId = await userIdByEmail(email);
    await withDb(async (c) => {
      await c.query("DELETE FROM connected_accounts WHERE user_id = $1 AND provider = 'credential'", [userId]);
      await c.query("INSERT INTO connected_accounts (user_id, provider, provider_account_id) VALUES ($1, 'discord', $2)", [userId, `e2e-d-${userId}`]);
      await c.query("UPDATE sessions SET created_at = now() - make_interval(mins => $2::int) WHERE user_id = $1", [userId, sessionAgeMinutes]);
    });
    // cookie cache 帶著舊的 session 資料：清掉，讓伺服器重新讀資料庫
    await page.context().clearCookies({ name: /session_data/ });
    return userId;
  }

  test("沒有密碼、session 過舊：顯示重新登入說明；按刪除 → 要求重新登入（不刪）；按重新登入 → 登入頁帶回跳", async ({ page }) => {
    const locale: TestLocale = "en";
    const userId = await socialOnlyUser(page, "delete7-stale", 30);
    await openPrivacy(page, locale);
    const danger = page.locator('[data-section="danger-zone"]');
    await expect(danger.getByTestId("delete-reauth")).toContainText(m(locale, "privacy.delete.noPassword", { minutes: "10" }));
    await expect(danger.getByLabel(m(locale, "privacy.delete.password"), { exact: true })).toHaveCount(0);

    await danger.getByLabel(m(locale, "privacy.delete.ack"), { exact: true }).check();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.button"), exact: true }).click();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.confirmButton"), exact: true }).click();
    const alert = danger.getByRole("alert").filter({ hasText: m(locale, "privacy.delete.reauthNeeded", { minutes: "10" }) });
    await expect(alert).toBeVisible();
    expect(await withDb(async (c) => (await c.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount)).toBe(1);

    await alert.getByRole("button", { name: m(locale, "privacy.delete.reauthButton"), exact: true }).click();
    await page.waitForURL(`**/${locale}/login?next=*`);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/${locale}/account/privacy`);
  });

  test("沒有密碼、session 夠新：不用密碼就能刪除", async ({ page }) => {
    const locale: TestLocale = "ja";
    const userId = await socialOnlyUser(page, "delete7-fresh", 2);
    await openPrivacy(page, locale);
    const danger = page.locator('[data-section="danger-zone"]');
    await danger.getByLabel(m(locale, "privacy.delete.ack"), { exact: true }).check();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.button"), exact: true }).click();
    await danger.getByRole("button", { name: m(locale, "privacy.delete.confirmButton"), exact: true }).click();
    await page.waitForURL(`**/${locale}/account/deleted`);
    await expect(page.getByTestId("account-deleted")).toHaveText(m(locale, "privacy.deleted.body"));
    expect(await withDb(async (c) => (await c.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount)).toBe(0);
  });
});

test.describe("/internal/users（Basic auth）", () => {
  test("沒有帳密 → 401", async ({ request }) => {
    const res = await request.get("/internal/users");
    expect(res.status()).toBe(401);
  });

  test("查詢 → 停權（撤銷 session）→ 解除；axe 無違規", async ({ page, browser }) => {
    const email = await signedInUser(page, "admin7-target", "被管理的人");
    const userId = await userIdByEmail(email);
    const sessionCount = () => withDb(async (c) => Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM sessions WHERE user_id = $1", [userId])).rows[0]!.n));
    const sessionsBefore = await sessionCount(); // 註冊與登入各一個
    expect(sessionsBefore).toBeGreaterThanOrEqual(1);

    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const admin = await ctx.newPage();
    try {
      const res = await admin.goto("/internal/users");
      expect(res?.status()).toBe(200);
      expect(res?.headers()["cache-control"]).toBe("no-store");
      await expect(admin.locator("main h1")).toHaveText("使用者管理");
      await expect(admin.getByText("目前沒有停權中的使用者")).toBeVisible();

      await admin.getByLabel("信箱（片段）或使用者 ID").fill(email.toUpperCase());
      await admin.getByRole("button", { name: "搜尋", exact: true }).click();
      const row = admin.locator(`tr[data-user-id="${userId}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(email.toLowerCase());
      await expect(row).toContainText("正常");
      await expectNoA11yViolations(admin, "使用者管理（搜尋結果）");

      await row.getByRole("button", { name: /^停權/ }).click();
      await expect(admin.getByRole("status")).toContainText(`#${userId} 已停權`);
      await expect(admin.getByRole("status")).toContainText(`已撤銷 ${sessionsBefore} 個登入狀態`);
      const suspendedRow = admin.locator(`tr[data-user-id="${userId}"]`);
      await expect(suspendedRow).toHaveAttribute("data-suspended", "true");
      await expect(suspendedRow).toContainText("停權中");
      expect(await sessionCount()).toBe(0);
      expect(new URL(admin.url()).searchParams.get("q")).toBe(email.toUpperCase());

      // 停權中的清單（沒有查詢時）也看得到
      await admin.goto("/internal/users");
      await expect(admin.locator(`tr[data-user-id="${userId}"]`)).toBeVisible();

      await admin.locator(`tr[data-user-id="${userId}"]`).getByRole("button", { name: /^解除停權/ }).click();
      await expect(admin.getByRole("status")).toContainText(`#${userId} 已解除停權`);
      expect(await withDb(async (c) => (await c.query<{ s: Date | null }>("SELECT suspended_at AS s FROM users WHERE id = $1", [userId])).rows[0]!.s)).toBeNull();

      // 以 ID 查詢
      await admin.goto(`/internal/users?q=${userId}`);
      await expect(admin.locator(`tr[data-user-id="${userId}"]`)).toBeVisible();
      await admin.setViewportSize({ width: 375, height: 812 });
      await expectNoA11yViolations(admin, "使用者管理（手機）");
    } finally {
      await ctx.close();
    }
  });

  test("沒有 CSRF token 的 POST → 403，不會停權", async ({ browser, page }) => {
    const email = await signedInUser(page, "admin7-csrf");
    const userId = await userIdByEmail(email);
    const ctx = await browser.newContext(adminAuth);
    try {
      const res = await ctx.request.post(`/internal/users/${userId}`, { form: { action: "suspend" }, headers: { origin: E2E_BASE_URL } });
      expect(res.status()).toBe(403);
      const cross = await ctx.request.post(`/internal/users/${userId}`, { form: { action: "suspend", csrf: "x" }, headers: { origin: "https://evil.example" } });
      expect(cross.status()).toBe(403);
      expect(await withDb(async (c) => (await c.query<{ s: Date | null }>("SELECT suspended_at AS s FROM users WHERE id = $1", [userId])).rows[0]!.s)).toBeNull();
    } finally {
      await ctx.close();
    }
  });
});

test.describe("隱私權政策（帳號段落）", () => {
  for (const locale of LOCALES) {
    test(`${locale}：有帳號蒐集、公開與私人、保存匯出刪除三段，axe 無違規`, async ({ page }) => {
      await page.goto(`/${locale}/about/privacy`);
      for (const id of ["accounts", "accountVisibility", "accountRetention"]) {
        await expect(page.locator(`#about-${id}`)).toBeVisible();
      }
      await expectNoA11yViolations(page, `隱私權政策 ${locale}`);
    });
  }
});
