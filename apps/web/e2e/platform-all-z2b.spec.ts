/**
 * 平台頁「全部遊戲」區段（Z2B 追加）：預設仍是 upcoming、可切到 all、排序（日期／熱度／名稱）在網址、
 * all 的筆數 ≥ upcoming 與 recent 合計（fixture 的平台上市列都有日期）。
 */
import { FIXTURE, expect, msg, test } from "./support/helpers";

const URL_BASE = `/zh-Hant/platforms/${FIXTURE.platformPs5}`;
const games = (page: import("@playwright/test").Page) => page.locator("[data-entity-games] > li");

test.describe("平台頁：全部遊戲", () => {
  test("預設是即將上市；點「全部遊戲」→ section=all，目前分頁 aria-current", async ({ page }) => {
    await page.goto(URL_BASE);
    const nav = page.getByRole("navigation", { name: msg("zh-Hant", "ui.platforms.sectionLabel") });
    await expect(nav.getByRole("link", { name: msg("zh-Hant", "ui.platforms.upcoming") })).toHaveAttribute("aria-current", /.+/);
    await nav.getByRole("link", { name: msg("zh-Hant", "ui.platforms.all") }).click();
    await expect(page).toHaveURL(/section=all$/);
    await expect(nav.getByRole("link", { name: msg("zh-Hant", "ui.platforms.all") })).toHaveAttribute("aria-current", /.+/);
    await expect(page.getByText(msg("zh-Hant", "ui.platforms.allHint"))).toBeVisible();
  });

  test("all 包含 upcoming 與 recent 的所有遊戲；名稱排序依 A→Z，網址 sort=name", async ({ page }) => {
    const slugs = async (qs: string): Promise<string[]> => {
      await page.goto(`${URL_BASE}${qs}`);
      return page.locator("[data-entity-games] > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-game") ?? ""));
    };
    const all = await slugs("?section=all");
    const up = await slugs("");
    const recent = await slugs("?section=recent");
    expect(all.length).toBeGreaterThan(0);
    for (const s of [...up, ...recent]) expect(all).toContain(s);

    await page.goto(`${URL_BASE}?section=all`);
    const nav = page.getByRole("navigation", { name: msg("zh-Hant", "ui.platforms.sortLabel") });
    await nav.getByRole("link", { name: msg("zh-Hant", "ui.platforms.sortName") }).click();
    await expect(page).toHaveURL(/section=all&sort=name$/);
    // 資料庫的排序規則決定 CJK 與拉丁字母的相對位置，所以只驗拉丁名稱彼此的順序
    const names = (await games(page).locator("a span.font-semibold").allTextContents()).map((n) => n.toLowerCase()).filter((n) => /^[a-z]/.test(n));
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort());
  });
});
