/**
 * 純鍵盤（15 Phase 3a 完成標準：純鍵盤可走完月曆 → 詳情；GameDex 第 3 段改版後）：
 * 跳到主要內容 → Tab 進月曆格（整格一個停駐點）→ 左右鍵切換同日其他款 → Tab 到封面連結 → Enter 開預覽卡 → 「查看遊戲詳情」→ 詳情頁。
 * 全程不用滑鼠。
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
  test(`純鍵盤：月曆 → 切換 → 預覽卡 → 詳情（${locale}）`, async ({ page }) => {
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

    // 從 main 繼續 Tab：款數 > 1 的格是一個停駐點（role=group），單款的格直接停在封面連結。
    // 本月第一個可聚焦的格是 5/8（5/1 以前沒有遊戲；月精度的遊戲在「本月未定日」）
    await tabUntil(page, ".cal-cell[data-count]");
    expect(await focusedDate(page)).toBe(FIXTURE.busyDay);
    // 焦點可見（:focus-visible 有外框）
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);
    const busy = page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"]`);

    // 左右鍵切換同日的其他款（焦點留在格上）；live region 宣告目前那款
    const name = (n: number) => `Busy Day Game ${String(n).padStart(2, "0")}`;
    await page.keyboard.press("ArrowRight");
    await expect(busy.locator(".cal-name")).toHaveText(name(2));
    await expect(busy.locator("[data-cal-live]")).toHaveText(msg(locale, "a11y.calendarCurrentGame", { name: name(2), index: 2, total: FIXTURE.busyCount }));
    await page.keyboard.press("ArrowLeft");
    await expect(busy.locator(".cal-name")).toHaveText(name(1));
    await expect(busy).toBeFocused();

    // Tab 進格後依序：封面連結 → 上一款 → 下一款；Shift+Tab 回到封面連結，Enter 開預覽卡，焦點移到標題
    // （accounts 啟用時，連結與切換鈕之間還有追蹤按鈕）
    await page.keyboard.press("Tab");
    await expect(busy.locator("a.cal-link")).toBeFocused();
    await tabUntil(page, '[data-cal-nav="prev"]', 4);
    await page.keyboard.press("Tab");
    await expect(busy.locator('[data-cal-nav="next"]')).toBeFocused();
    for (let i = 0; i < 4 && !(await busy.locator("a.cal-link").evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Shift+Tab");
    await expect(busy.locator("a.cal-link")).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.side-sheet");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#sheet-title")).toBeFocused();
    await expect(page.locator("#sheet-title")).toHaveText(name(1));

    // modal：Tab 不會跑到對話框外的頁面元素（原生 showModal 讓背景 inert；
    // 循環到最後時瀏覽器會把焦點交給網址列等瀏覽器 UI，此時 activeElement 是 body，屬原生行為）
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "browser-ui";
        return el.closest("dialog.side-sheet") ? "dialog" : `outside:${el.tagName}`;
      });
      expect(where).not.toMatch(/^outside/);
    }

    // Esc 關閉，焦點回到原本的封面連結
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(busy.locator("a.cal-link")).toBeFocused();

    // 單款的格（5/15 主角）：Tab 直接停在封面連結（沒有群組停駐點）→ Enter 開預覽卡 → Tab 到「查看遊戲詳情」→ Enter 進詳情頁
    await page.locator(`.cal-cell[data-date="${FIXTURE.multiPlatformDay}"] a.cal-link`).focus();
    await page.keyboard.press("Enter");
    const heroName = locale === "zh-Hant" ? FIXTURE.hero.zhName : FIXTURE.hero.name;
    await expect(page.locator("#sheet-title")).toHaveText(heroName);
    await expect(page.locator("#sheet-title")).toBeFocused();
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
