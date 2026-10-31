/**
 * 2026-10-30：扁平化改版——/games 的精簡工具列（篩選圖示鈕、浮出面板、卡片大小切換）與無漸層背景。
 */
import { expect, expectNoA11yViolations, test } from "./support/helpers";
import { FIXTURE_Z2A as Z } from "./support/fixture-z2a";

const URL_ALL = `/en/games?q=${Z.q}`;

test.describe("/games 精簡工具列", () => {
  test("卡片大小：封面／詳細卡片／清單切換，記在 localStorage，重新整理後保留", async ({ page }) => {
    await page.goto(URL_ALL);
    const html = page.locator("html");
    const group = page.getByRole("group", { name: "Card size" });
    await expect(group.getByRole("button", { name: "Cards with details" })).toHaveAttribute("aria-pressed", "true");

    await group.getByRole("button", { name: "Covers only" }).click();
    await expect(html).toHaveAttribute("data-gd-view", "cover");
    await expect(page.locator(".bc-item .bc-meta").first()).toBeHidden(); // 封面模式只留名稱

    await group.getByRole("button", { name: "List" }).click();
    await expect(html).toHaveAttribute("data-gd-view", "list");
    await expect(group.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(html).toHaveAttribute("data-gd-view", "list");
    await expectNoA11yViolations(page, "/games 清單檢視");
  });

  test("篩選面板：圖示鈕浮出面板（不推開結果），點外面或 Esc 關閉", async ({ page }) => {
    await page.goto(URL_ALL);
    const panel = page.locator("details.filter-panel");
    // 頁面座標（點擊會把按鈕捲進視窗，視窗座標會跟著動）
    const pageTop = (): Promise<number> => page.evaluate(() => document.querySelector(".bc-list")!.getBoundingClientRect().top + window.scrollY);
    const top = await pageTop();
    await page.locator("summary.filter-summary").click();
    await expect(panel).toHaveAttribute("open", "");
    expect(Math.abs((await pageTop()) - top)).toBeLessThan(6); // 結果沒被往下推（篩選面板約 300px 高；容許版面微幅位移）
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveAttribute("open", "");
    await page.locator("summary.filter-summary").click();
    await expect(panel).toHaveAttribute("open", "");
    await page.locator("h1").click();
    await expect(panel).not.toHaveAttribute("open", "");
  });

  test("扁平化：body 沒有環境光漸層，header 沒有模糊", async ({ page }) => {
    await page.goto(URL_ALL);
    const bg = await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage);
    expect(bg).toBe("none");
    const blur = await page.locator(".site-header").evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blur).toBe("none");
  });

  test("篩選欄位預設折疊，已有選值的自動展開；排序選單與升降冪箭頭", async ({ page }) => {
    await page.addInitScript(() => ((window as unknown as { __keepFolds: boolean }).__keepFolds = true));
    await page.goto(URL_ALL);
    await page.locator("summary.filter-summary").click();
    const folds = page.locator("details.fold");
    expect(await folds.count()).toBeGreaterThan(3);
    await expect(page.locator("details.fold[open]")).toHaveCount(0);
    await expect(page.locator('input[name="platformKind"][value="console"]')).toBeHidden();
    await page.locator("details.fold > summary", { hasText: "Platform type" }).click();
    await expect(page.locator('input[name="platformKind"][value="console"]')).toBeVisible();
    await page.locator('input[name="platformKind"][value="console"]').check();
    await expect(page).toHaveURL(/platformKind=console/);
    await expect(page.locator("details.fold[open]")).toHaveCount(1); // 有選值的欄位重新載入後自動展開

    // 排序：預設熱度高到低（箭頭向下）；選單換標的、箭頭反向
    await page.getByRole("button", { name: "Heat" }).click();
    await page.getByRole("option", { name: "Release date" }).click();
    await expect(page).toHaveURL(/sort=release_date/);
    await page.getByRole("button", { name: /Release date.*Ascending/ }).click();
    await page.getByRole("option", { name: /Release date/ }).click(); // 再選一次目前的標的＝切換升降冪
    await expect(page).toHaveURL(/sort=release_date_desc/);
    // 左側的方向三角本身也能點：切回升冪
    await page.getByRole("button", { name: "Descending", exact: true }).click();
    await expect(page).toHaveURL(/sort=release_date$/);
  });
});
