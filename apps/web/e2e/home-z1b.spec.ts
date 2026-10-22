/**
 * GameDex 第二輪（任務書 Z1B）：
 * - 首頁熱門區「即將上市／已上市」分頁（D86）：兩組都由伺服器渲染、點擊與方向鍵切換、查看更多隨分頁改變、
 *   指示條動畫（點擊 200ms transform、鍵盤 0ms、reduced-motion 無）、無 JS 時第一組可見。
 * - 近期活動空狀態：不在 e2e 驗證（會動到共用 DB），改由整合測試（home-dashboard）與元件渲染單元測試（home-events-empty）驗證。
 * - 舊時間軸 API（/api/timeline、/group、/history）已移除 → 404。
 * - 首頁亮／暗 axe、320px 無水平溢出。
 */
import type { Page } from "@playwright/test";
import { horizontalOverflow } from "./support/accounts";
import { FIXTURE_HOME, LOCALES, expect, expectNoA11yViolations, msg, test } from "./support/helpers";

type Group = "upcoming" | "released";
const tab = (page: Page, group: Group) => page.locator(`[data-trending-tab="${group}"]`);
const panel = (page: Page, group: Group) => page.locator(`[data-trending-panel="${group}"]`);
const more = (page: Page) => page.locator('[data-home-more="trending"]');
const indicatorDuration = (page: Page) => page.locator("[data-trending-indicator]").evaluate((el) => getComputedStyle(el).transitionDuration);

test.describe("首頁熱門分頁", () => {
  test("預設即將上市；兩組都在伺服器 HTML 裡；切換不重新請求；查看更多連到對應榜單", async ({ page, request }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain(FIXTURE_HOME.released[0].slug); // 已上市那組也在 HTML（切換不重新請求）
    expect(html).toContain(FIXTURE_HOME.upcoming[0].slug);

    await page.goto("/en");
    const tablist = page.getByRole("tablist", { name: msg("en", "ui.trending.groupLabel") });
    await expect(tablist.getByRole("tab")).toHaveText([msg("en", "ui.trending.upcoming"), msg("en", "ui.trending.released")]);
    await expect(tab(page, "upcoming")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "released")).toHaveAttribute("aria-selected", "false");
    await expect(tab(page, "upcoming")).toHaveAttribute("tabindex", "0");
    await expect(tab(page, "released")).toHaveAttribute("tabindex", "-1");
    await expect(panel(page, "upcoming")).toBeVisible();
    await expect(panel(page, "released")).toBeHidden();
    await expect(panel(page, "upcoming").locator("[data-home-game]").first()).toBeVisible();
    await expect(more(page)).toHaveAttribute("href", "/en/trending");

    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await tab(page, "released").click();
    await expect(tab(page, "released")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page, "released")).toBeVisible();
    await expect(panel(page, "upcoming")).toBeHidden();
    await expect(panel(page, "released").locator(`[data-home-game="${FIXTURE_HOME.released[0].slug}"]`)).toBeVisible();
    await expect(more(page)).toHaveAttribute("href", "/en/trending?group=released");
    await expect(more(page)).toHaveAccessibleName(
      msg("en", "ui.home.moreAria", { section: `${msg("en", "ui.home.trending.title")} (${msg("en", "ui.trending.released")})` }),
    );
    expect(requests.filter((u) => !u.includes("_next/image") && !u.includes("images.igdb.com"))).toEqual([]);

    await more(page).click();
    await page.waitForURL(/\/en\/trending\?group=released$/);
  });

  test("鍵盤：←→ 切換並移動焦點、Home／End；鍵盤沒有動畫（0s），點擊才有 200ms", async ({ page }) => {
    await page.goto("/en");
    expect(await indicatorDuration(page)).toBe("0.2s");
    await tab(page, "upcoming").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "released")).toBeFocused();
    await expect(tab(page, "released")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page, "released")).toBeVisible();
    await expect(more(page)).toHaveAttribute("href", "/en/trending?group=released");
    expect(await indicatorDuration(page)).toBe("0s");
    await page.keyboard.press("ArrowRight"); // 環狀
    await expect(tab(page, "upcoming")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab(page, "released")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab(page, "upcoming")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "released")).toBeFocused();
    // Tab 離開 tablist 進到面板內的連結（roving tabindex：tablist 只有一個停靠點）
    await page.keyboard.press("Tab");
    await expect(panel(page, "released").locator("a").first()).toBeFocused();
    // 滑鼠點擊切回：恢復 200ms，指示條回到第一格
    await tab(page, "upcoming").click();
    expect(await indicatorDuration(page)).toBe("0.2s");
    await expect
      .poll(() => page.locator("[data-trending-indicator]").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41))
      .toBe(0);
  });

  test("prefers-reduced-motion：指示條不做 transform 轉場", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await tab(page, "released").click();
    await expect(panel(page, "released")).toBeVisible();
    expect(await page.locator("[data-trending-indicator]").evaluate((el) => getComputedStyle(el).transitionProperty)).toBe("none");
  });

  test.describe("沒有 JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("第一組可見；已上市榜單可由連結取得", async ({ page }) => {
      await page.goto("/en");
      await expect(panel(page, "upcoming")).toBeVisible();
      await expect(panel(page, "released")).toBeHidden();
      await expect(more(page)).toHaveAttribute("href", "/en/trending");
      await expect(page.locator('noscript a[href="/en/trending?group=released"]')).toHaveCount(1);
    });
  });

  for (const locale of LOCALES) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${locale} ${scheme}：兩個分頁 axe 無違規`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/${locale}`);
        await expect(panel(page, "upcoming").locator("[data-home-game]").first()).toBeVisible();
        await expectNoA11yViolations(page, `${locale} ${scheme} 首頁（即將上市）`);
        await tab(page, "released").click();
        await expect(panel(page, "released").locator("[data-home-game]").first()).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0)); // sticky header 不要蓋住其他區塊（axe target-size）
        await expectNoA11yViolations(page, `${locale} ${scheme} 首頁（已上市）`);
      });
    }
  }

  test("320px：兩個分頁都沒有水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/en");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await tab(page, "released").click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("舊時間軸 API 已移除", () => {
  for (const url of ["/api/timeline?locale=en", "/api/timeline/group?locale=en&key=tbd", "/api/timeline/history?locale=en&ids=1"]) {
    test(`GET ${url} → 404`, async ({ request }) => {
      expect((await request.get(url)).status()).toBe(404);
    });
  }
  test("新的週視圖 API 仍可用", async ({ request }) => {
    expect((await request.get("/api/v1/timeline/week?locale=en")).status()).toBe(200);
  });
});
