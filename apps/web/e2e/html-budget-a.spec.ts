/**
 * 全站 HTML 瘦身（06 §瀏覽與搜尋 的頁面大小預算，HTML < 200,000 bytes）：
 * - 有篩選面板（FilterPanel）的每個頁面 × 三個語系，fixture 資料下的 HTML 位元組數。
 *   fixture 只有 3 個平台，所以這裡鎖的是「頁面本身」的大小；篩選面板的單位成本由 test/unit/html-budget-a.test.ts 鎖住，
 *   真實資料（約 210 個平台）下的整頁大小用 `node scripts/html-size.mjs <網址> <路徑…>` 量。
 * - 評分排名頁不再只列常用平台：全部平台都有核取方塊；沒有 JS 也能展開、勾選、送出。
 * - 熱門榜榜單由客戶端元件吃緊湊的列：SSR 的 HTML 結構不變（名次、連結、熱度文字都在），火焰圖示共用一份 sprite。
 */
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, msg, test } from "./support/helpers";

const HTML_BUDGET = 200_000;

const PAGES: { label: string; path: string }[] = [
  { label: "月曆", path: "/calendar" },
  { label: "時間軸", path: "/timeline" },
  { label: "時間軸（週）", path: "/timeline?week=2037-W10" },
  { label: "熱門榜（即將上市）", path: "/trending" },
  { label: "熱門榜（已上市）", path: "/trending?group=released" },
  { label: "評分排名", path: "/ratings" },
  { label: "瀏覽", path: "/games" },
  { label: "瀏覽（不分組）", path: "/games?by=none" },
  { label: "平台頁", path: `/platforms/${FIXTURE.platformPs5}` },
  { label: "公司頁", path: "/companies/e2e-northern-studio" },
  { label: "系列頁", path: "/franchises/e2e-aurora-saga" },
];

test.describe("HTML 預算：有篩選面板的頁面", () => {
  for (const p of PAGES) {
    test(`${p.label}：三個語系的 HTML < ${HTML_BUDGET} bytes`, async ({ request }) => {
      for (const locale of LOCALES) {
        const res = await request.get(`/${locale}${p.path}`);
        expect(res.status(), `${locale}${p.path}`).toBe(200);
        const bytes = (await res.body()).length;
        expect(bytes, `${locale}${p.path} HTML ${bytes} bytes`).toBeLessThan(HTML_BUDGET);
      }
    });
  }
});

test.describe("評分排名頁：完整平台清單", () => {
  test("所有平台都有核取方塊（不只常用或已勾選）", async ({ request }) => {
    const html = await (await request.get("/zh-Hant/ratings")).text();
    for (const slug of [FIXTURE.platformPs5, FIXTURE.platformSwitch, "e2e-pc"]) {
      expect(html, slug).toMatch(new RegExp(`<input type=checkbox name=platform value=${slug}[ >]`));
    }
    expect(html).not.toMatch(/value=e2e-switch checked/);
  });

  test("沒有 JS：展開面板、勾選非常用平台、送出，網址帶 platform 且該平台已勾選", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "zh-TW" });
    const page = await ctx.newPage();
    await page.goto("/zh-Hant/ratings");
    await page.locator("summary.filter-summary").click();
    await page.locator(".more-platforms > summary").click();
    await page.getByLabel("E2E Nintendo Switch", { exact: true }).check();
    await page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).click();
    await expect(page).toHaveURL(/\/zh-Hant\/ratings\?.*platform=e2e-switch/);
    await page.locator("summary.filter-summary").click();
    await expect(page.getByLabel("E2E Nintendo Switch", { exact: true })).toBeChecked();
    await ctx.close();
  });

  test("axe：面板展開後 0 違規", async ({ page }) => {
    await page.goto("/zh-Hant/ratings");
    await page.locator("summary.filter-summary").click();
    await page.locator(".more-platforms > summary").click();
    await expectNoA11yViolations(page, "評分排名（面板展開）");
  });
});

test.describe("熱門榜：榜單結構", () => {
  test("沒有 JS：榜單列、名次、連結、熱度文字都在伺服器 HTML，火焰圖示共用 sprite；篩選送得出去", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "zh-TW" });
    const page = await ctx.newPage();
    const res = await page.request.get("/zh-Hant/trending");
    const html = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, ""); // RSC payload（self.__next_f）另算
    expect(html).toContain("trending-heat-flame");
    expect((html.match(/M8\.6 1c/g) ?? []).length).toBe(1); // sprite 裡的那一份
    await page.goto("/zh-Hant/trending");
    const items = page.locator("[data-trending-item]");
    expect(await items.count()).toBeGreaterThan(0);
    const first = items.first();
    await expect(first.locator("a")).toHaveAttribute("href", /^\/zh-Hant\/games\//);
    await expect(first).toContainText(/^\s*第\s*1\s*名/);
    await expect(first).toContainText(/熱度 [1-5]\/5/);
    await page.locator("summary.filter-summary").click();
    await page.locator(".more-platforms > summary").click();
    await page.getByLabel("E2E Nintendo Switch", { exact: true }).check();
    await page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).click();
    await expect(page).toHaveURL(/\/zh-Hant\/trending\?.*platform=e2e-switch/);
    await ctx.close();
  });
});
