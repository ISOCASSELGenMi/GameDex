/**
 * 純鍵盤（15 Phase 3a 完成標準：純鍵盤可走完月曆 → 詳情）：
 * 跳到主要內容 → 月曆 grid → 方向鍵 → Enter 開當天清單 → Esc 回原格 → 預覽卡 → 詳情頁。全程不用滑鼠。
 */
import type { Page } from "@playwright/test";
import { FIXTURE, calendarUrl, expect, gameUrl, msg, test, waitForCalendarReady, type TestLocale } from "./support/helpers";

const focusedDate = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date ?? null);

/** 按 Tab 直到焦點落在符合條件的元素（最多 max 次）；回傳按了幾次。 */
async function tabUntil(page: Page, predicate: string, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => !!document.activeElement?.matches(sel), predicate)) return i;
  }
  throw new Error(`按了 ${max} 次 Tab 仍未到達 ${predicate}`);
}

for (const locale of ["zh-Hant", "en", "ja"] as const satisfies readonly TestLocale[]) {
  test(`純鍵盤：月曆 → 預覽卡 → 詳情（${locale}）`, async ({ page }) => {
    await page.goto(calendarUrl(locale, FIXTURE.month));
    await waitForCalendarReady(page);

    // 第一個 Tab：跳到主要內容
    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveText(msg(locale, "a11y.skipToContent"));
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();

    // 從 main 繼續 Tab 進入月曆 grid：整個 grid 只有一個 Tab 停駐點（roving tabindex），本月沒有今天 → 1 日
    await tabUntil(page, 'td[role="gridcell"][data-date]');
    expect(await focusedDate(page)).toBe(`${FIXTURE.month}-01`);
    // 焦點可見（:focus-visible 有外框）
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);

    // 方向鍵
    await page.keyboard.press("ArrowRight");
    expect(await focusedDate(page)).toBe(`${FIXTURE.month}-02`);
    await page.keyboard.press("ArrowDown");
    expect(await focusedDate(page)).toBe(`${FIXTURE.month}-09`);
    await page.keyboard.press("ArrowLeft");
    expect(await focusedDate(page)).toBe(FIXTURE.busyDay);
    await page.keyboard.press("ArrowUp");
    expect(await focusedDate(page)).toBe(`${FIXTURE.month}-01`);
    await page.keyboard.press("ArrowDown");
    expect(await focusedDate(page)).toBe(FIXTURE.busyDay);
    // 只有目前格子是 tabindex=0
    await expect(page.locator('.cal-desktop td[data-date][tabindex="0"]')).toHaveCount(1);

    // Enter：當天完整清單（8 款全部列出），焦點在對話框標題
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.side-sheet");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#sheet-title")).toBeFocused();
    await expect(dialog.locator("button.sheet-entry")).toHaveCount(FIXTURE.busyCount);

    // modal：Tab 不會跑到對話框外的頁面元素（原生 showModal 讓背景 inert；
    // 循環到最後時瀏覽器會把焦點交給網址列等瀏覽器 UI，此時 activeElement 是 body，屬原生行為）
    for (let i = 0; i < FIXTURE.busyCount + 4; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "browser-ui";
        return el.closest("dialog.side-sheet") ? "dialog" : `outside:${el.tagName}`;
      });
      expect(where).not.toMatch(/^outside/);
    }

    // Esc 關閉，焦點回到原本的格子
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await focusedDate(page)).toBe(FIXTURE.busyDay);

    // 往下一週到三平台同日的那天 → Enter → Tab 到第一個項目 → Enter 開預覽卡
    await page.keyboard.press("ArrowDown");
    expect(await focusedDate(page)).toBe(FIXTURE.multiPlatformDay);
    await page.keyboard.press("Enter");
    await expect(page.locator("#sheet-title")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.locator("button.sheet-entry").first()).toBeFocused();
    await page.keyboard.press("Enter");
    const heroName = locale === "zh-Hant" ? FIXTURE.hero.zhName : FIXTURE.hero.name;
    await expect(page.locator("#sheet-title")).toHaveText(heroName);
    await expect(page.locator("#sheet-title")).toBeFocused();

    // 預覽卡內 Tab 到「查看遊戲詳情」→ Enter 進詳情頁
    await page.keyboard.press("Tab");
    const viewGame = dialog.locator("a.btn-primary");
    await expect(viewGame).toBeFocused();
    await expect(viewGame).toHaveText(msg(locale, "ui.calendar.viewGame"));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${gameUrl(locale, FIXTURE.hero.slug)}$`));
    await expect(page.locator("article.detail h1")).toHaveText(heroName);

    // 詳情頁也從「跳到主要內容」開始
    await page.keyboard.press("Tab");
    await expect(page.locator("a.skip-link")).toBeFocused();
  });
}

test("當天清單 → 預覽卡 →「回到當天清單」焦點回到原項目；Esc 後焦點回到原格子", async ({ page }) => {
  await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
  await waitForCalendarReady(page);
  const cell = page.locator(`.cal-desktop td[data-date="${FIXTURE.busyDay}"]`);
  await cell.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog.side-sheet");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const second = dialog.locator('button.sheet-entry').nth(1);
  await expect(second).toBeFocused();
  const key = await second.getAttribute("data-entry");
  await page.keyboard.press("Enter");
  // 預覽卡上方：「回到當天清單」
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: msg("zh-Hant", "ui.calendar.backToList") })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(`button.sheet-entry[data-entry="${key}"]`)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cell).toBeFocused();
});
