/**
 * GameDex 改版第 3 段（下，X2）e2e：時間軸（週）、手機 header 收合選單、全站視覺與動態（axe 亮／暗、reduced-motion、320px）。
 * fixture：2037-W10（2037-03-02 週一）有單日 13 款的 bigDay 與後續填充；固定網址進入，不依賴「今天」。
 */
import type { Page } from "@playwright/test";
import { FIXTURE, FIXTURE_3B, LOCALES, expect, expectNoA11yViolations, headerMenu, msg, openHeaderMenu, test } from "./support/helpers";
import { horizontalOverflow, signedInUser } from "./support/accounts";

const TL = FIXTURE_3B.timeline;
const WEEK = "2037-W10";
const MOBILE = { width: 375, height: 812 };

async function ready(page: Page): Promise<void> {
  await expect(page.locator('.tw-card[data-hydrated="true"]').first()).toBeAttached();
}

/** 模擬 Linux CI 較寬的字形（本機 Windows 字型較窄會漏掉溢出）：只用在水平溢出檢查。 */
async function widenFonts(page: Page): Promise<void> {
  await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; letter-spacing: 0.05em !important; }" });
}

const range = (page: Page) => page.locator("[data-week-range]");

test.describe("時間軸（週）：結構與網址", () => {
  test("一週一頁：週區間、有序清單、每個日期節點有可及名稱、當日數量、網址可分享", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    await expect(range(page)).toHaveAttribute("data-week", WEEK);
    const list = page.locator("ol.tw-axis");
    await expect(list).toHaveCount(1);
    const days = list.locator("> li.tw-day");
    expect(await days.count()).toBeGreaterThan(1);
    // 節點可及名稱＝完整日期；卡片群組名稱含款數
    const node = page.locator(`.tw-day[data-date="${TL.bigDay}"] h3`);
    await expect(node).toHaveText(/March 2/);
    const card = page.locator(`.tw-day[data-date="${TL.bigDay}"] .tw-card`);
    await expect(card).toHaveAttribute("data-count", String(TL.bigDayCount));
    await expect(card.locator("[data-day-count]")).toHaveText(msg("en", "ui.timeline.releasesCount", { count: TL.bigDayCount }));
    await expect(card).toHaveAccessibleName(new RegExp(String(TL.bigDayCount)));
    // 只有第一款（其餘按需載入）
    await expect(card.locator("[data-day-card]")).toHaveCount(1);
    // 週內所有日期都在區間內
    const dates = await days.evaluateAll((els) => els.map((e) => e.getAttribute("data-date")!));
    expect(dates.every((d) => d >= "2037-03-02" && d <= "2037-03-08")).toBe(true);
    expect([...dates].sort()).toEqual(dates);
  });

  test("舊網址 at= 與 week 都可用；不合法的 week 退回今天所在週", async ({ page }) => {
    await page.goto(`/en/timeline?at=2037-03-10`);
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    await page.goto(`/en/timeline?week=2037-W11`);
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    await page.goto(`/en/timeline?week=garbage&at=2037-03-02`);
    await expect(range(page)).toHaveAttribute("data-week", WEEK);
    const res = await page.goto(`/en/timeline?week=2037-W99`);
    expect(res?.status()).toBe(200);
    await expect(range(page)).toHaveAttribute("data-week", /^\d{4}-W\d{2}$/);
    await expect(range(page)).not.toHaveAttribute("data-week", "2037-W99");
  });

  test("左右交錯（桌機）：奇偶日期的卡片在中軸兩側，橫線連到節點", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    const axis = await page.locator("ol.tw-axis").boundingBox();
    const mid = axis!.x + axis!.width / 2;
    const days = page.locator("li.tw-day");
    const n = await days.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      const day = days.nth(i);
      await expect(day).toHaveAttribute("data-side", i % 2 === 0 ? "left" : "right");
      const box = (await day.locator(".tw-card").boundingBox())!;
      if (i % 2 === 0) expect(box.x + box.width, `第 ${i} 張在左`).toBeLessThan(mid);
      else expect(box.x, `第 ${i} 張在右`).toBeGreaterThan(mid);
    }
  });

  for (const width of [375, 320]) {
    test(`手機 ${width}px：中軸靠左、卡片都在右側、無水平捲動`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/en/timeline?week=${WEEK}`);
      await ready(page);
      const nodes = page.locator(".tw-node");
      const cards = page.locator(".tw-card");
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        const nb = (await nodes.nth(i).boundingBox())!;
        const cb = (await cards.nth(i).boundingBox())!;
        expect(cb.x, `第 ${i} 張卡在節點右側`).toBeGreaterThan(nb.x + nb.width);
        expect(cb.x + cb.width).toBeLessThanOrEqual(width);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await widenFonts(page);
      expect(await horizontalOverflow(page), "字形加寬後").toBeLessThanOrEqual(0);
    });
  }
});

test.describe("時間軸（週）：切換", () => {
  test("上一週／下一週：網址、區間、aria-live 宣告、焦點留在按鈕、上一頁回到前一週", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    const next = page.locator("a[data-week-nav=next]");
    await expect(next).toHaveAccessibleName(/Next week/);
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    await expect(page).toHaveURL(/week=2037-W11/);
    await expect(page.locator("[data-timeline-status]")).toContainText(/releases/);
    await expect(next).toBeFocused();
    await page.locator("a[data-week-nav=prev]").click();
    await expect(range(page)).toHaveAttribute("data-week", WEEK);
    await expect(page).toHaveURL(new RegExp(`week=${WEEK}`));
    await page.goBack();
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    await page.goBack();
    await expect(range(page)).toHaveAttribute("data-week", WEEK);
  });

  test("回到今天：今天所在週（有今天線）；跳到指定日期：該日所在週", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    await page.locator("a[data-week-nav=today]").click();
    await expect(range(page)).not.toHaveAttribute("data-week", WEEK);
    await expect(page.locator("[data-timeline-today]")).toBeVisible();
    await page.locator("#tl-at").fill("2037-03-10");
    await page.locator("#tl-at").press("Enter");
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    await expect(page).toHaveURL(/week=2037-W11/);
  });

  test("沒有 JS：週切換是連結、跳日期是 GET 表單，整頁導覽後仍有內容", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(`/en/timeline?week=${WEEK}`);
    await expect(page.locator("li.tw-day").first()).toBeVisible();
    await expect(page.locator("a[data-week-nav=next]")).toHaveAttribute("href", /week=2037-W11/);
    await page.locator("a[data-week-nav=next]").click();
    await expect(page).toHaveURL(/week=2037-W11/);
    await expect(page.locator("li.tw-day").first()).toBeVisible();
    await page.locator("#tl-at").fill("2037-03-03");
    await page.locator("form.tw-jump button[type=submit]").click();
    await expect(page).toHaveURL(/at=2037-03-03/);
    await expect(range(page)).toHaveAttribute("data-week", WEEK);
    await ctx.close();
  });

  test("同日多款：按需載入（切換前沒有 day API 請求），切換後名稱與位置改變，到頭尾繞回", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/calendar/day")) calls.push(r.url());
    });
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    const card = page.locator(`.tw-day[data-date="${TL.bigDay}"] .tw-card`);
    const nameBefore = await card.locator(".tw-name").textContent();
    expect(calls).toHaveLength(0);
    await card.locator('[data-cal-nav="next"]').click();
    await expect(card.locator(".tw-poscount")).toHaveText(`2 / ${TL.bigDayCount}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`date=${TL.bigDay}`);
    expect(await card.locator(".tw-name").textContent()).not.toBe(nameBefore);
    await expect(card.locator("[data-cal-live]")).toContainText(/2/);
    await card.locator('[data-cal-nav="prev"]').click();
    await card.locator('[data-cal-nav="prev"]').click();
    await expect(card.locator(".tw-poscount")).toHaveText(`${TL.bigDayCount} / ${TL.bigDayCount}`);
    expect(calls).toHaveLength(1);
  });

  test("鍵盤：Tab 停在多款卡片，方向鍵切換；卡片內控制項要先 Tab 進卡片", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    const card = page.locator(`.tw-day[data-date="${TL.bigDay}"] .tw-card`);
    await card.focus();
    await expect(card).toHaveAttribute("data-engaged", "true");
    await page.keyboard.press("ArrowRight");
    await expect(card.locator(".tw-poscount")).toHaveText(`2 / ${TL.bigDayCount}`);
    await page.keyboard.press("ArrowLeft");
    await expect(card.locator(".tw-poscount")).toHaveText(`1 / ${TL.bigDayCount}`);
  });

  test("平台種類篩選：連結切換、保留 week、顯示在週切換之上", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    const kinds = page.locator("[data-kind-filter] a.tw-kind");
    expect(await kinds.count()).toBeGreaterThan(0);
    await kinds.first().click();
    await expect(page).toHaveURL(/platformKind=/);
    await expect(page).toHaveURL(new RegExp(`week=${WEEK}`));
    await expect(page.locator("a.tw-kind[aria-current=true]")).toHaveCount(1);
    // 篩選之後切週，篩選條件仍在網址
    await page.locator("a[data-week-nav=next]").click();
    await expect(page).toHaveURL(/platformKind=.*week=2037-W11/);
    const filterBox = (await page.locator("[data-kind-filter]").boundingBox())!;
    const navBox = (await page.locator("nav.tw-nav").boundingBox())!;
    expect(filterBox.y).toBeLessThan(navBox.y);
  });

  test("空的一週：顯示沒有符合的訊息，週切換仍可用", async ({ page }) => {
    await page.goto(`/en/timeline?week=2030-W02`);
    await expect(page.locator("[data-timeline-empty]")).toHaveText(msg("en", "ui.timeline.empty"));
    await expect(page.locator("a[data-week-nav=next]")).toBeVisible();
  });
});

// 手機 header 收合選單已由 Holodex 式 header 取代（GameDex 第二輪 Z1A，見 gamedex-redesign-z1a.spec.ts）

test.describe("減少動態", () => {
  test.use({ reducedMotion: "reduce" });

  test("時間軸切週、header 下拉功能正常，且沒有進場動畫", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    await page.locator("a[data-week-nav=next]").click();
    await expect(range(page)).toHaveAttribute("data-week", "2037-W11");
    const anim = await page.locator(".tw-stage").evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe("none");
    const mainAnim = await page.locator("main > *").first().evaluate((el) => getComputedStyle(el).animationName);
    expect(mainAnim).toBe("none");
    // header 下拉：減少動態時仍可開合
    const panel = await openHeaderMenu(page, "nav");
    await expect(panel.getByRole("navigation", { name: msg("en", "a11y.mainNavigation") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(headerMenu(page, "nav").trigger).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("axe：亮色與暗色", () => {
  const PAGES: [string, string][] = [
    ["首頁", "/"],
    ["時間軸", `/timeline?week=${WEEK}`],
    ["遊戲詳情", `/games/${FIXTURE.hero.slug}`],
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const locale of LOCALES) {
      test(`${locale} ${scheme}：首頁、時間軸（含展開的 header 下拉）、遊戲詳情`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        for (const [label, p] of PAGES) {
          await page.goto(`/${locale}${p}`);
          await expect(page.locator("main h1").first()).toBeVisible();
          if (label === "時間軸") await ready(page);
          await expectNoA11yViolations(page, `${locale} ${scheme} ${label}`);
        }
        await page.setViewportSize(MOBILE);
        await page.goto(`/${locale}/timeline?week=${WEEK}`);
        await ready(page);
        await openHeaderMenu(page, "language");
        await expectNoA11yViolations(page, `${locale} ${scheme} 手機 header 語言下拉展開`);
      });
    }

    test(`${scheme}：帳號頁（登入後）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await signedInUser(page, `x2-${scheme}`);
      await page.goto(`/en/account`);
      await expect(page.locator("[data-account-shell]")).toBeVisible();
      await expect(page.getByTestId("account-name")).toBeVisible();
      await expectNoA11yViolations(page, `帳號頁 ${scheme}`);
    });
  }

  test("手機 320px：時間軸、首頁、遊戲詳情無水平捲動", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const p of ["/timeline?week=" + WEEK, "/", `/games/${FIXTURE.hero.slug}`]) {
      await page.goto(`/en${p}`);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await horizontalOverflow(page), p).toBeLessThanOrEqual(0);
      await widenFonts(page);
      expect(await horizontalOverflow(page), `${p}（字形加寬後）`).toBeLessThanOrEqual(0);
    }
  });
});
