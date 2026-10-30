/**
 * 2026-10-30：篩選即時套用（06 §篩選 UI）。
 * - 勾選／選擇／輸入後自動更新結果，有 JS 時沒有「套用」按鈕（沒有 JS 仍有）；全部清除保留。
 * - 篩選不改變位置：月曆的年月、時間軸的週、/games 的分組與起算月／組排序／頁碼、評分排名的累計頁數都留在網址上；捲動位置不跳回頂端。
 * - 焦點不被奪走；結果更新用 aria-live 宣告。
 */
import type { Locator, Page } from "@playwright/test";
import { calendarUrl, expect, expectNoA11yViolations, FIXTURE, FIXTURE_3B, msg, test } from "./support/helpers";
import { FIXTURE_Z2A as Z } from "./support/fixture-z2a";

const WEEK = "2037-W10";
const panelForm = (page: Page): Locator => page.locator('.filter-panel form.filter-form[data-live="on"]').first();
const apply = (page: Page): Locator => panelForm(page).locator('button[type="submit"]');
const clearAll = (page: Page): Locator => panelForm(page).locator("[data-filter-clear]");

async function openPanel(page: Page): Promise<void> {
  await page.locator("summary.filter-summary").first().click();
  await expect(panelForm(page)).toBeVisible();
}
/** 在 window 上放記號：整頁重新載入會消失，客戶端導覽不會。 */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __live: number }).__live = 1;
  });
}
const marked = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __live?: number }).__live === 1);
const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));
/** 記下「變更發生當下」的捲動位置（Playwright 的 check() 會先把元素捲進視窗，測試端事先量的值不準）。 */
async function trackScrollAtChange(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.addEventListener("change", () => ((window as unknown as { __yChange: number }).__yChange = Math.round(window.scrollY)), true);
  });
}
/** 把目標捲到視窗上緣附近（之後 check() 不必再捲動，變更當下的位置才是測試要守住的位置）。 */
const scrollNear = (target: Locator): Promise<void> =>
  target.evaluate((el) => {
    // 頁面不一定夠高（CI 的 Linux 字型／內容量不同）：在 body 末端加撐高元素（不在 React 管轄內，客戶端導覽後仍在），確保有東西可捲
    if (!document.getElementById("e2e-scroll-pad")) {
      const pad = document.createElement("div");
      pad.id = "e2e-scroll-pad";
      pad.style.height = "3000px";
      document.body.appendChild(pad);
    }
    window.scrollTo(0, Math.round(window.scrollY + el.getBoundingClientRect().top - 140));
  });
const scrollAtChange = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __yChange: number }).__yChange);
/** 導覽之後捲動位置仍在變更當下的位置（容許 4 px）。 */
async function expectScrollKept(page: Page): Promise<void> {
  const y = await scrollAtChange(page);
  expect(y).toBeGreaterThan(100);
  await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(4);
}

test.describe("月曆", () => {
  test("勾選即更新：沒有套用按鈕、不重新載入、年月與捲動位置保留；全部清除也留在原月份", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await openPanel(page);
    await expect(apply(page)).toBeHidden();
    await mark(page);
    await trackScrollAtChange(page);
    // 面板最下面的「包含傳聞」核取方塊：頁面往下捲到面板底部再操作，捲動位置才有東西可守
    const rumored = page.locator('input[name="rumored"]');
    await scrollNear(rumored);

    await rumored.check();
    await expect(page).toHaveURL(new RegExp(`/zh-Hant/calendar/${FIXTURE.month}\\?rumored=1$`));
    await expect(page.locator("a.filter-chip")).toHaveCount(1);
    expect(await marked(page)).toBe(true);
    await expectScrollKept(page);
    await expect(rumored).toBeChecked();

    await clearAll(page).click();
    await expect(page).toHaveURL(new RegExp(`/zh-Hant/calendar/${FIXTURE.month}$`));
    await expect(page.locator("a.filter-chip")).toHaveCount(0);
    await expect(rumored).not.toBeChecked();
    expect(await marked(page)).toBe(true);
  });

  test("連續快速勾選合併：最後的網址包含全部勾選，焦點留在剛操作的核取方塊，並以 aria-live 宣告", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await openPanel(page);
    const kind = (v: string) => page.locator(`input[name="platformKind"][value="${v}"]`);
    await kind("console").check();
    await kind("pc").check();
    await expect(page).toHaveURL(/platformKind=console(,|%2C)pc/);
    // 取消勾選一個，焦點不跑掉
    await kind("pc").focus();
    await page.keyboard.press("Space");
    await expect(page).not.toHaveURL(/pc/);
    await expect(kind("pc")).toBeFocused();
    await expect(kind("pc")).not.toBeChecked();
    const status = panelForm(page).locator("[data-live-status]");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveText(msg("zh-Hant", "filters.live.updated"));
  });

  test("沒有 JS：套用按鈕仍在，送出後留在同一個月份", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "zh-TW" });
    const page = await ctx.newPage();
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await page.locator("summary.filter-summary").first().click();
    await page.locator('input[name="platformKind"][value="console"]').check();
    const button = page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(new RegExp(`/zh-Hant/calendar/${FIXTURE.month}\\?platformKind=console$`));
    await ctx.close();
  });

  test("axe：面板展開並套用篩選後 0 違規", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await openPanel(page);
    await page.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
    await expectNoA11yViolations(page, "月曆（即時篩選後）");
  });
});

test.describe("時間軸", () => {
  const ready = async (page: Page) => {
    await expect(page.locator('.tw-card[data-hydrated="true"]').first()).toBeAttached();
    await expect(page.locator('a[data-week-nav="next"]')).toBeVisible();
  };

  test("切週之後再篩選：留在目前的那一週（不回預設週），捲動位置保留；清除與 chip 移除也一樣", async ({ page }) => {
    await page.goto(`/en/timeline?week=${WEEK}`);
    await ready(page);
    await page.locator("a[data-week-nav=next]").click();
    await expect(page.locator("[data-week-range]")).toHaveAttribute("data-week", "2037-W11");
    await expect(page).toHaveURL(/week=2037-W11/);
    await openPanel(page);
    await expect(apply(page)).toBeHidden();
    await mark(page);
    await trackScrollAtChange(page);
    await scrollNear(page.locator('input[name="genre"][value="shooter"]'));

    await page.locator('input[name="genre"][value="shooter"]').check();
    await expect(page).toHaveURL(/genre=shooter/);
    await expect(page).toHaveURL(/week=2037-W11/);
    await expect(page.locator("[data-week-range]")).toHaveAttribute("data-week", "2037-W11");
    expect(await marked(page)).toBe(true);
    await expectScrollKept(page);

    // chip 移除：week 仍是 W11
    await page.locator("a.filter-chip").first().click();
    await expect(page).not.toHaveURL(/genre=/);
    await expect(page).toHaveURL(/week=2037-W11/);

    // 再切到 W12，用面板的「全部清除」
    await page.locator('input[name="genre"][value="shooter"]').check();
    await expect(page).toHaveURL(/genre=shooter/);
    await page.locator("a[data-week-nav=next]").click();
    await expect(page).toHaveURL(/week=2037-W12/);
    await clearAll(page).click();
    await expect(page).not.toHaveURL(/genre=/);
    await expect(page).toHaveURL(/week=2037-W12/);
    expect(await marked(page)).toBe(true);
  });

  test("日期跳轉（at）之後篩選：保留目前那一週", async ({ page }) => {
    await page.goto(`/en/timeline?at=${FIXTURE_3B.timeline.bigDay}`);
    await ready(page);
    await openPanel(page);
    await page.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
    await expect(page.locator("[data-week-range]")).toHaveAttribute("data-week", WEEK);
  });

  test("沒有 JS：套用按鈕仍在，送出後留在原本的那一週", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "en-US" });
    const page = await ctx.newPage();
    await page.goto(`/en/timeline?week=${WEEK}`);
    await page.locator("summary.filter-summary").first().click();
    await page.locator('input[name="genre"][value="shooter"]').check();
    await page.getByRole("button", { name: msg("en", "filters.apply") }).first().click();
    await expect(page).toHaveURL(/genre=shooter/);
    await expect(page).toHaveURL(new RegExp(`week=${WEEK}`));
    await ctx.close();
  });
});

test.describe("/games 瀏覽", () => {
  const URL_ALL = `/en/games?q=${Z.q}`;

  test("分組與 gfrom：篩選後 by／gfrom 保留；搜尋框 q 只在 Enter 套用（不邊打邊導覽）", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    await expect(page.locator('form[data-live="on"]').first()).toBeAttached();
    await openPanel(page);
    await mark(page);
    await page.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
    await expect(page).toHaveURL(/by=date/);
    await expect(page).toHaveURL(/gfrom=2036-10/);
    await expect(page).toHaveURL(new RegExp(`q=${Z.q}`));
    expect(await marked(page)).toBe(true);

    const q = page.locator("#browse-search");
    await q.fill("zzz-no-such");
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(new RegExp(`q=${Z.q}`));
    await q.press("Enter");
    await expect(page).toHaveURL(/q=zzz-no-such/);
    await expect(page).toHaveURL(/gfrom=2036-10/);
  });

  test("分組依廠商：gsort／gdir 保留；排序下拉與年份欄位也即時套用", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=publisher&gdir=asc&gsort=name`);
    await expect(page.locator('form[data-live="on"]').first()).toBeAttached();
    await openPanel(page);
    await page.locator('input[name="platformKind"][value="pc"]').check();
    await expect(page).toHaveURL(/platformKind=pc/);
    await expect(page).toHaveURL(/by=publisher&gdir=asc&gsort=name/);

    await page.goto(`${URL_ALL}`);
    await expect(page.locator('form[data-live="on"]').first()).toBeAttached();
    await page.locator("select[name=sort]").selectOption("name");
    await expect(page).toHaveURL(/sort=name/);
    await page.locator("input[name=yearFrom]").fill("2036");
    await expect(page).toHaveURL(/yearFrom=2036/); // debounce 400ms 後套用
    await expect(page).toHaveURL(/sort=name/);
  });

  test("不分組：篩選後頁碼超出範圍就退到最後一頁", async ({ page }) => {
    await page.goto(`/en/games?page=2`);
    await expect(page.locator("li[data-browse-item]").first()).toBeVisible();
    await openPanel(page);
    // 「曾延期」的遊戲只有兩款：第 2 頁已超出範圍 → 最後一頁（第 1 頁）
    await page.locator('input[name="status"][value="delayed"]').check();
    await expect(page).toHaveURL(/status=delayed/);
    await expect(page).not.toHaveURL(/page=/);
    expect(await page.locator("li[data-browse-item]").count()).toBeGreaterThan(0);
  });

  test("不分組：頁碼在範圍內時保留", async ({ page }) => {
    await page.goto(`/en/games?page=2`);
    await expect(page.locator("li[data-browse-item]").first()).toBeVisible();
    await openPanel(page);
    await page.locator('input[name="platformKind"][value="pc"]').check();
    await expect(page).toHaveURL(/platformKind=pc/);
    // fixture 的 PC 遊戲多於一頁：頁碼不變；若不足一頁，退到最後一頁（無 page 參數）
    const url = page.url();
    expect(/page=2/.test(url) || !/page=/.test(url)).toBe(true);
  });

  test("沒有 JS：套用按鈕仍在；分組參數隨表單送出", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    await page.locator("summary.filter-summary").first().click();
    await page.locator('input[name="platformKind"][value="console"]').check();
    await page.locator(".filter-panel button.btn-primary").click();
    await expect(page).toHaveURL(/gfrom=2036-10/);
    await expect(page).toHaveURL(/platformKind=console/);
    await ctx.close();
  });
});

test.describe("評分排名", () => {
  const url = (q = "") => `/zh-Hant/ratings${q ? `?${q}` : ""}`;
  const rows = (page: Page) => page.locator("[data-rk-row]");

  test("勾選即更新：累計頁數 page 與排序保留；最低票數 debounce 後套用；全部清除", async ({ page }) => {
    await page.goto(url("sort=players&dir=asc&page=2"));
    await expect(rows(page).first()).toBeVisible();
    await openPanel(page);
    await expect(apply(page)).toBeHidden();
    await mark(page);
    await page.locator('input[name="platformKind"][value="pc"]').check();
    await expect(page).toHaveURL(/platformKind=pc/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/sort=players/);
    await expect(page).toHaveURL(/dir=asc/);
    expect(await marked(page)).toBe(true);

    await page.locator("input[name=minVotes]").fill("6");
    await expect(page).toHaveURL(/minVotes=6/);
    await expect(page).toHaveURL(/platformKind=pc/);

    await clearAll(page).click();
    await expect(page).not.toHaveURL(/platformKind=/);
    await expect(page).not.toHaveURL(/minVotes=/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('input[name="platformKind"][value="pc"]')).not.toBeChecked();
  });

  test("axe：面板展開並套用後 0 違規", async ({ page }) => {
    await page.goto(url());
    await expect(rows(page).first()).toBeVisible();
    await openPanel(page);
    await page.locator('input[name="platformKind"][value="pc"]').check();
    await expect(page).toHaveURL(/platformKind=pc/);
    await expectNoA11yViolations(page, "評分排名（即時篩選後）");
  });
});

test.describe("手機抽屜與熱門榜", () => {
  test("手機底部抽屜：勾選即更新且抽屜不會自己關閉", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForHydration(page);
    await page.locator("[data-filter-panel] > button").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-live-status]")).toHaveText(msg("zh-Hant", "filters.live.updated"));
  });

  test("熱門榜：勾選即更新", async ({ page }) => {
    await page.goto("/zh-Hant/trending");
    await openPanel(page);
    await expect(apply(page)).toBeHidden();
    await page.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
  });
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("[data-filter-panel] > button")).toBeVisible();
}
