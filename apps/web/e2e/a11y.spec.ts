/**
 * axe（WCAG 2.0／2.1／2.2 A＋AA）：月曆（桌機／手機）、詳情、篩選後、空結果、預覽卡、格內切換後、深色模式。違規 0 才通過。
 */
import { FIXTURE, LOCALES, calendarUrl, expect, expectNoA11yViolations, gameUrl, test, waitForCalendarReady } from "./support/helpers";

const MOBILE = { width: 375, height: 812 };

/** 把頁面上所有 <details> 展開，讓收合內容（篩選面板、＋N、未定日）也被檢查。 */
async function openAllDetails(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")));
}

for (const locale of LOCALES) {
  test.describe(`axe（${locale}）`, () => {
    test("月曆：桌機", async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await waitForCalendarReady(page);
      await expectNoA11yViolations(page, `${locale} 月曆桌機`);
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 月曆桌機（全部展開）`);
    });

    test("月曆：手機寬度", async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await waitForCalendarReady(page);
      await expect(page.locator(".cal-grid")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} 月曆手機`);
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 月曆手機（全部展開）`);
    });

    test("遊戲詳情", async ({ page }) => {
      await page.goto(gameUrl(locale, FIXTURE.hero.slug));
      await expect(page.locator("article.detail h1")).toBeVisible();
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 詳情`);
    });

    test("篩選後的月曆", async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month, `platform=${FIXTURE.platformPs5}&genre=${FIXTURE.genreRpg}`));
      await waitForCalendarReady(page);
      await expect(page.locator("a.filter-chip")).toHaveCount(2);
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 篩選後`);
    });

    test("空結果的月曆", async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month, `platform=${FIXTURE.platformSwitch}&genre=${FIXTURE.genreShooter}`));
      await expect(page.locator(".empty-result")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} 空結果`);
    });

    test("預覽卡與格內切換後", async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await waitForCalendarReady(page);
      const cell = page.locator(`.cal-cell[data-date="${FIXTURE.multiPlatformDay}"]`);
      await cell.locator("a.cal-link").click();
      const dialog = page.locator("dialog.side-sheet");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("a.btn-primary")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} 預覽卡`);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      const busy = page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"]`);
      await busy.locator("[data-cal-nav=next]").click();
      await expect(busy).toHaveAttribute("data-index", "1");
      await expectNoA11yViolations(page, `${locale} 格內切換後`);
    });
  });
}

test.describe("axe：深色模式對比", () => {
  test.use({ colorScheme: "dark" });

  for (const locale of LOCALES) {
    test(`月曆＋預覽卡（${locale}）`, async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month, `platform=${FIXTURE.platformPs5}`));
      await waitForCalendarReady(page);
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 深色月曆`);
      await page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"] a.cal-link`).click();
      await expect(page.locator("dialog.side-sheet a.btn-primary")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} 深色預覽卡`);
    });

    test(`月曆手機＋詳情（${locale}）`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await waitForCalendarReady(page);
      await expect(page.locator(".cal-grid")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} 深色月曆手機`);
      await page.goto(gameUrl(locale, FIXTURE.hero.slug));
      await expect(page.locator("article.detail h1")).toBeVisible();
      await openAllDetails(page);
      await expectNoA11yViolations(page, `${locale} 深色詳情`);
    });
  }
});

test.describe("axe：提示與錯誤頁", () => {
  test("未知篩選值的提示", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "platform=nope-console&stage=bogus"));
    await expect(page.locator(".notice[role=note]")).toBeVisible();
    await expectNoA11yViolations(page, "未知篩選值提示");
  });

  test("找不到頁面：proxy 404 與遊戲不存在（軟 404）", async ({ page }) => {
    const res = await page.goto("/en/calendar/2036-13");
    expect(res?.status()).toBe(404);
    await expectNoA11yViolations(page, "proxy 404");
    await page.goto(gameUrl("zh-Hant", "e2e-no-such-game"));
    await expect(page.locator("h1")).toBeVisible();
    await expectNoA11yViolations(page, "遊戲不存在");
  });
});

test.describe("prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("預覽卡的進場動畫被關閉", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    await page.locator(`.cal-cell[data-date="${FIXTURE.multiPlatformDay}"] a.cal-link`).click();
    const dialog = page.locator("dialog.side-sheet");
    await expect(dialog).toBeVisible();
    const ms = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000);
    expect(ms).toBeLessThanOrEqual(1);
  });
});
