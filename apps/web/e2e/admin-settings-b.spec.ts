/**
 * 後台設定與擴充（B、C）＋ Metacritic 預設關閉（D）的端到端：
 * - /internal/settings、/internal/sync：Basic auth（未帶 401）、axe、共用導覽、儲存／還原／驗證錯誤、變更歷史
 * - POST 的 CSRF 與同源檢查（缺 token、錯誤來源 403）
 * - Metacritic 預設關閉：/internal/matches 404、設定頁顯示「關」、瀏覽器對 metacritic.com 的請求數為 0、評分排名頁沒有 Metascore／Userscore 欄
 * 只改不影響其他測試的設定（評分來源優先序、Userscore 顯示），結束時還原成預設。
 * 帳密只加在各測試自己開的 context（不用 test.use：它會讓 playwright.request 的匿名請求也帶帳密）。
 */
import type { Browser, Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_BASE_URL } from "./support/env";
import { expect, expectNoA11yViolations, installFixedClock, test } from "./support/helpers";

const adminAuth = { httpCredentials: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } };
test.describe.configure({ mode: "serial" });

async function withAdmin(browser: Browser, fn: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ baseURL: E2E_BASE_URL, timezoneId: "UTC", locale: "zh-TW", ...adminAuth });
  try {
    await installFixedClock(ctx);
    await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

test.describe("後台設定與同步監控", () => {
  test("未帶帳密 401；帶帳密可開設定頁與同步監控頁，兩頁共用導覽", async ({ browser, playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: E2E_BASE_URL });
    for (const p of ["/internal/settings", "/internal/sync"]) {
      const r = await anon.get(p);
      expect(r.status()).toBe(401);
      expect(r.headers()["www-authenticate"]).toContain("Basic");
    }
    expect((await anon.post("/internal/settings/save", { form: { group: "ratings", mode: "save" } })).status()).toBe(401);
    await anon.dispose();

    await withAdmin(browser, async (page) => {
      await page.goto("/internal/settings");
      await expect(page.getByRole("heading", { level: 1, name: "網站設定" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "內部頁面" });
      await expect(nav.getByRole("link")).toHaveText(["資料更正回報", "待回饋 IGDB", "使用者管理", "網站設定", "同步監控"]);
      await expect(nav.getByRole("link", { name: "網站設定" })).toHaveAttribute("aria-current", "page");
      await nav.getByRole("link", { name: "同步監控" }).click();
      await expect(page).toHaveURL(/\/internal\/sync$/);
      await expect(page.getByRole("heading", { level: 1, name: "同步監控" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "內部頁面" }).getByRole("link", { name: "同步監控" })).toHaveAttribute("aria-current", "page");
      for (const [name, path] of [["資料更正回報", /internal\/reports/], ["使用者管理", /internal\/users/]] as const) {
        await page.getByRole("navigation", { name: "內部頁面" }).getByRole("link", { name }).click();
        await expect(page).toHaveURL(path);
        await expect(page.getByRole("navigation", { name: "內部頁面" })).toBeVisible();
      }
    });
  });

  test("設定頁與同步監控頁沒有 axe 違規", async ({ browser }) => {
    await withAdmin(browser, async (page) => {
      await page.goto("/internal/settings");
      await expect(page.locator('[data-settings-group="ratings"]')).toBeVisible();
      await expectNoA11yViolations(page, "internal settings");
      await page.goto("/internal/sync");
      await expect(page.locator('[data-sync-table="jobs"]')).toBeVisible();
      await expectNoA11yViolations(page, "internal sync");
    });
  });

  test("模組啟停唯讀、註明需修改環境變數並重啟；Metacritic 預設關（環境變數與後台兩道開關）", async ({ browser }) => {
    await withAdmin(browser, async (page) => {
      await page.goto("/internal/settings");
      await expect(page.getByText("需修改環境變數並重啟").first()).toBeVisible();
      await expect(page.locator('[data-module="catalog"]')).toHaveAttribute("data-enabled", "true");
      await expect(page.locator('[data-module="accounts"]')).toHaveAttribute("data-enabled", "true");
      await expect(page.locator('[data-module="metacritic"]')).toHaveAttribute("data-enabled", "false"); // 列出但停用（registry 不收它的任務與排名欄）
      await expect(page.locator("[data-mc-env]")).toHaveAttribute("data-mc-env", "off");
      await expect(page.locator("[data-mc-effective]")).toHaveAttribute("data-mc-effective", "off");
      // 模組列表是唯讀：表格內沒有任何表單控制項
      await expect(page.locator('[data-settings-group="modules"] table').locator("input, button, select")).toHaveCount(0);
    });
  });

  test("儲存評分設定 → 提示、重新載入仍在、變更歷史多一列；還原成預設", async ({ browser }) => {
    await withAdmin(browser, async (page) => {
      await page.goto("/internal/settings");
      const form = page.locator('[data-settings-group="ratings"]');
      await form.getByLabel("第 1 順位").selectOption("igdb");
      await form.getByLabel("第 2 順位").selectOption("metacritic_scrape");
      await form.getByLabel("顯示 Userscore（玩家評分）").uncheck();
      await form.getByRole("button", { name: "儲存" }).click();
      await expect(page).toHaveURL(/saved=ratings/);
      await expect(page.locator('[data-flash="saved"]')).toContainText("已儲存");

      const again = page.locator('[data-settings-group="ratings"]');
      await expect(again.getByLabel("第 1 順位")).toHaveValue("igdb");
      await expect(again.getByLabel("顯示 Userscore（玩家評分）")).not.toBeChecked();
      await expect(again.getByLabel("顯示 Metascore（媒體評分）")).toBeChecked();
      await expect(again.getByText("目前來源：後台設定").first()).toBeVisible();
      const history = page.locator("[data-settings-history] tbody tr");
      await expect(history.filter({ hasText: E2E_ADMIN_USER }).first()).toBeVisible(); // 操作者是 Basic auth 的使用者名稱
      await expect(page.locator("[data-settings-history]")).toContainText("主分數優先序");
      await expect(page.locator("[data-settings-history]")).toContainText("顯示 Userscore");

      await again.getByRole("button", { name: /還原成預設/ }).click();
      await expect(page.locator('[data-flash="saved"]')).toContainText("已還原成預設");
      await expect(page.locator('[data-settings-group="ratings"]').getByLabel("顯示 Userscore（玩家評分）")).toBeChecked();
      await expect(page.locator('[data-settings-group="ratings"]').getByText("目前來源：環境變數／內建預設").first()).toBeVisible();
    });
  });

  test("驗證失敗：月曆預設沒選任何類型 → 錯誤提示、不寫入", async ({ browser }) => {
    await withAdmin(browser, async (page) => {
      await page.goto("/internal/settings");
      const form = page.locator('[data-settings-group="calendar"]');
      const boxes = form.getByRole("checkbox");
      const n = await boxes.count();
      for (let i = 0; i < n; i += 1) await boxes.nth(i).uncheck();
      await form.getByRole("button", { name: "儲存" }).click();
      await expect(page.locator('[data-flash="error"]')).toContainText("至少");
      await page.goto("/internal/settings");
      await expect(page.locator('[data-settings-group="calendar"]').getByText("目前來源：環境變數／內建預設").first()).toBeVisible();
    });
  });

  test("POST 的 CSRF 與同源檢查：缺 token、錯誤來源、錯誤 token 都是 403，且不寫入", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: E2E_BASE_URL, ...adminAuth });
    const origin = { origin: E2E_BASE_URL };
    const form = { group: "metacritic", mode: "save", scrape_allowed: "on" };
    expect((await api.post("/internal/settings/save", { form: { ...form, csrf: "x" }, headers: origin })).status()).toBe(403);
    expect((await api.post("/internal/settings/save", { form, headers: origin })).status()).toBe(403);
    expect((await api.post("/internal/settings/save", { form: { ...form, csrf: "1.2" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await api.post("/internal/settings/save", { form: { ...form, csrf: "x" } })).status()).toBe(403); // 沒有 Origin／Referer
    await api.dispose();
  });
});

test.describe("Metacritic 預設關閉", () => {
  test("/internal/matches 沒有內容（模組停用）；瀏覽公開頁面時瀏覽器對 metacritic.com 的請求數為 0；評分排名頁沒有 Metacritic 欄", async ({ browser }) => {
    await withAdmin(browser, async (page) => {
      const hits: string[] = [];
      page.on("request", (r) => {
        if (/metacritic\.com/i.test(r.url())) hits.push(r.url());
      });
      await page.goto("/internal/matches");
      // notFound() 在串流頁面可能已送出 200 狀態，所以看內容：沒有覆核頁、也沒有覆核導覽項
      await expect(page.getByRole("heading", { name: "Metacritic 比對覆核" })).toHaveCount(0);
      await expect(page.locator("[data-matches]")).toHaveCount(0);
      await page.goto("/en/ratings");
      await expect(page.getByRole("columnheader").first()).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Metascore|Userscore/ })).toHaveCount(0);
      await page.goto("/en/calendar");
      await page.goto("/en/games");
      expect(hits).toEqual([]);
    });
  });
});
