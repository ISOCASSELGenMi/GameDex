/**
 * 月曆「本月未定日」摺起來的組只送熱度最高的前 24 款（方案 A，06 §月曆）。
 * fixture：seed-fold.ts（2038-12：年精度 30 款 → 摺起來只送前 24 款＋「查看全部 30 款」；季精度正好 24 款 → 完整卡片、沒有連結）。
 */
import type { Page } from "@playwright/test";
import { FIXTURE_FOLD as F, foldName } from "./support/fixture-fold";
import { calendarUrl, expect, expectNoA11yViolations, LOCALES, msg, test } from "./support/helpers";

const HTML_BUDGET = 250_000;
const yearGroup = (page: Page) => page.locator("details.undated-group").filter({ has: page.locator("ul.fold-list") }).first();

test.describe("未定日摺起來的組：前 24 款＋查看全部", () => {
  test("只送前 24 款（熱度高到低）、連結目標正確；HTML 預算", async ({ request }) => {
    for (const locale of LOCALES) {
      const res = await request.get(calendarUrl(locale, F.month));
      expect(res.status()).toBe(200);
      const body = await res.body();
      expect(body.length, `${locale} HTML ${body.length} bytes`).toBeLessThan(HTML_BUDGET);
      const html = body.toString("utf8");
      // 前 24 款（HTML 與 RSC payload 都算）；第 25～30 款整個不在回應裡（不是用 CSS 藏起來）
      for (let i = 1; i <= F.shown; i++) expect(html, `${locale} Year ${i}`).toContain(foldName(F.yearGroup.prefix, i));
      for (let i = F.shown + 1; i <= F.yearGroup.count; i++) expect(html, `${locale} Year ${i}`).not.toContain(foldName(F.yearGroup.prefix, i));
      expect(html).toContain(`href="/${locale}/games?year=${F.year}&amp;by=date"`);
      expect(html.match(/class="undated-more"/g) ?? []).toHaveLength(1); // 只有年精度那組；季精度 24 款沒有連結
    }
  });

  test("畫面：摺起來的組 24 列、有連結；季精度組展開顯示 24 張完整卡片、沒有連結", async ({ page }) => {
    await page.goto(calendarUrl("en", F.month));
    const year = yearGroup(page);
    await expect(year.locator("summary")).toContainText("30");
    await expect(year).not.toHaveAttribute("open", "");
    await year.locator("summary").click();
    await expect(year.locator("ul.fold-list > li")).toHaveCount(F.shown);
    const link = year.getByRole("link", { name: msg("en", "ui.calendar.undatedViewAll", { count: F.yearGroup.count }) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/en/games?year=${F.year}&by=date`);

    const quarter = page.locator("details.undated-group").filter({ has: page.locator("ul.undated-tiles") });
    await expect(quarter).toHaveAttribute("open", "");
    await expect(quarter.locator("ul.undated-tiles > li")).toHaveCount(F.quarterGroup.count);
    await expect(quarter.locator(".undated-more")).toHaveCount(0);
  });

  test("連結保留月曆的篩選，點進去是瀏覽頁的日期分組", async ({ page }) => {
    await page.goto(calendarUrl("en", F.month, `platform=${F.platform}`));
    const year = yearGroup(page);
    await year.locator("summary").click();
    const link = year.getByRole("link", { name: msg("en", "ui.calendar.undatedViewAll", { count: F.yearGroup.count }) });
    await expect(link).toHaveAttribute("href", `/en/games?platform=${F.platform}&year=${F.year}&by=date`);
    await link.click();
    await expect(page).toHaveURL(`/en/games?platform=${F.platform}&year=${F.year}&by=date`);
    await expect(page.locator("section[data-rc-group]").first()).toBeVisible();
  });

  test("沒有 JS：連結仍可用", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "zh-TW" });
    const page = await ctx.newPage();
    await page.goto(calendarUrl("zh-Hant", F.month));
    await yearGroup(page).locator("summary").click();
    await page.getByRole("link", { name: msg("zh-Hant", "ui.calendar.undatedViewAll", { count: F.yearGroup.count }) }).click();
    await expect(page).toHaveURL(`/zh-Hant/games?year=${F.year}&by=date`);
    await expect(page.locator("section[data-rc-group]").first()).toBeVisible();
    await ctx.close();
  });

  test("axe 0 違規（三語、展開後）；320px 沒有水平溢出", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(calendarUrl(locale, F.month));
      for (const s of await page.locator("details.undated-group > summary").all()) {
        if (!(await s.locator("xpath=..").getAttribute("open"))) await s.click();
      }
      await expectNoA11yViolations(page, `月曆未定日（${locale}）`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(calendarUrl("en", F.month));
    await yearGroup(page).locator("summary").click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
