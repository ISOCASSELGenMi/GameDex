/**
 * axe（WCAG 2.0／2.1／2.2 A＋AA）：Phase 3b 新頁面——時間軸、熱門榜、遊戲瀏覽／搜尋、平台／公司／系列、活動、
 * 遊戲詳情的語言支援三態。每頁 zh-Hant／en × 桌機／手機 375 寬；<details> 全展開後 0 違規；手機無水平捲動；
 * 不存在的 slug 是軟 404（notFound 版面＋noindex）。fixture 見 support/seed.ts（FIXTURE_3B）。
 */
import { FIXTURE, FIXTURE_3B, LOCALES, expect, expectNoA11yViolations, msg, test } from "./support/helpers";

const MOBILE = { width: 375, height: 812 };
const TL = FIXTURE_3B.timeline;

/** 要檢查的頁面（去掉語系前綴）。label 供失敗訊息。 */
const PAGES: { label: string; path: string }[] = [
  { label: "時間軸（2037-03-02 那一週）", path: `/timeline?week=2037-W10` },
  { label: "時間軸（舊網址 at=）", path: `/timeline?at=${TL.bigDay}` },
  { label: "時間軸（預設起點）", path: "/timeline" },
  { label: "時間軸（空結果）", path: `/timeline?platform=${FIXTURE.platformSwitch}&genre=${FIXTURE.genreShooter}` },
  { label: "熱門榜（即將上市）", path: "/trending" },
  { label: "熱門榜（已上市）", path: "/trending?group=released" },
  { label: "瀏覽", path: "/games" },
  { label: "瀏覽（第 2 頁）", path: "/games?page=2" },
  { label: "瀏覽（搜尋）", path: `/games?q=${FIXTURE_3B.searchTerm}` },
  { label: "瀏覽（排序＋年份）", path: "/games?sort=name&yearFrom=2036&yearTo=2036" },
  { label: "瀏覽（空結果）", path: "/games?q=zzzznomatchzzzz" },
  { label: "平台總覽", path: "/platforms" },
  { label: "平台頁", path: `/platforms/${FIXTURE.platformPs5}` },
  { label: "平台頁（近期上市＋熱度排序）", path: `/platforms/${FIXTURE.platformPs5}?section=recent&sort=popularity` },
  { label: "平台頁（全部遊戲＋名稱排序）", path: `/platforms/${FIXTURE.platformPs5}?section=all&sort=name` },
  { label: "公司頁", path: "/companies/e2e-northern-studio" },
  { label: "公司頁（角色篩選）", path: "/companies/e2e-northern-studio?role=publisher" },
  { label: "系列頁", path: "/franchises/e2e-aurora-saga" },
  { label: "系列頁（franchise，同 slug 有合集）", path: `/franchises/${FIXTURE_3B.twin.slug}` },
  { label: "系列頁（collection）", path: `/franchises/${FIXTURE_3B.twin.slug}?kind=collection` },
  { label: "活動列表（即將）", path: "/events" },
  { label: "活動列表（類型 expo）", path: "/events?kind=expo" },
  { label: "活動列表（類型＋已結束）", path: "/events?kind=awards&when=past" },
  { label: "活動列表（時間未定）", path: "/events?when=undated" },
  { label: "活動詳情", path: `/events/${FIXTURE_3B.events.showcase.slug}` },
  { label: "活動詳情（有相關遊戲）", path: `/events/${FIXTURE_3B.events.expo.slug}` },
  { label: "活動詳情（時間未定）", path: `/events/${FIXTURE_3B.events.undated.slug}` },
  { label: "遊戲詳情（語言支援：有資料）", path: `/games/${FIXTURE.hero.slug}` },
  { label: "遊戲詳情（語言支援：某欄未提供資料）", path: `/games/${FIXTURE_3B.langPartial.slug}` },
  { label: "遊戲詳情（語言支援：整區尚無資料）", path: `/games/${FIXTURE_3B.langNone.slug}` },
  { label: "遊戲詳情（同系列＋同名合集）", path: "/games/e2e-twin-both" },
];

async function openAllDetails(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")));
}

async function expectNoHorizontalScroll(page: import("@playwright/test").Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}：手機寬度不可水平捲動（溢出 ${overflow}px）`).toBeLessThanOrEqual(0);
}

for (const locale of LOCALES) {
  test.describe(`axe 3b（${locale}）`, () => {
    for (const { label, path } of PAGES) {
      test(`${label}：桌機`, async ({ page }) => {
        const res = await page.goto(`/${locale}${path}`);
        expect(res?.status()).toBe(200);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expectNoA11yViolations(page, `${locale} ${path} 桌機`);
        await openAllDetails(page);
        await expectNoA11yViolations(page, `${locale} ${path} 桌機（全部展開）`);
      });

      test(`${label}：手機 375 寬`, async ({ page }) => {
        await page.setViewportSize(MOBILE);
        const res = await page.goto(`/${locale}${path}`);
        expect(res?.status()).toBe(200);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expectNoHorizontalScroll(page, `${locale} ${path}`);
        await expectNoA11yViolations(page, `${locale} ${path} 手機`);
        await openAllDetails(page);
        await expectNoA11yViolations(page, `${locale} ${path} 手機（全部展開）`);
        await expectNoHorizontalScroll(page, `${locale} ${path}（全部展開）`);
      });
    }

    test("時間軸：切週、同日切換款數之後仍 0 違規", async ({ page }) => {
      await page.goto(`/${locale}/timeline?week=2037-W10`);
      await expect(page.locator('.tw-card[data-hydrated="true"]').first()).toBeAttached();
      const big = page.locator(`.tw-day[data-date="${TL.bigDay}"] .tw-card`);
      await big.locator('[data-cal-nav="next"]').click();
      await expect(big.locator("[data-day-card]")).toHaveAttribute("data-dir", "next");
      await page.locator("a[data-week-nav=next]").click();
      await expect(page.locator("[data-week-range]")).not.toHaveAttribute("data-week", "2037-W10");
      await expect(page.locator("[data-timeline-status]")).toContainText(/\d/);
      await expectNoA11yViolations(page, `${locale} 時間軸（切週＋切換款數後）`);
    });

    test("軟 404：不存在的 slug 回 notFound 版面＋noindex", async ({ page }) => {
      const paths = [
        "/games/nope-no-such-game",
        "/platforms/nope",
        "/companies/nope",
        "/franchises/nope",
        `/franchises/${FIXTURE.hero.slug}`, // 遊戲 slug 不是系列
        `/franchises/e2e-aurora-saga?kind=collection`, // 該 slug 沒有 collection
        "/events/nope",
      ];
      for (const p of paths) {
        const res = await page.goto(`/${locale}${p}`);
        expect([200, 404], p).toContain(res?.status());
        await expect(page.locator("h1"), p).toHaveText(msg(locale, "errors.notFound.title"));
        await expect(page.locator('meta[name="robots"]'), p).toHaveAttribute("content", /noindex/);
      }
      await expectNoA11yViolations(page, `${locale} 軟 404`);
    });
  });
}

