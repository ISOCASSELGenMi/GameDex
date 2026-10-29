/**
 * e2e 時間固定（support/helpers.ts 的 fixedClock）：不論測試實際在幾點跑，瀏覽器端的時刻都不在夜貓子時段（UTC 02:00～03:59），
 * 所以夜貓子彩蛋（本地 02:00～03:59 自動解鎖 night-owl 主題）不會干擾一般頁面的測試。
 * 夜貓子本身（會解鎖／不會解鎖的時段）的測試在 eggs-z3a.spec.ts，那裡自己用 page.clock.setFixedTime 指定時間。
 */
import { browserTime, expect, openHeaderMenu, test } from "./support/helpers";

const nowHour = (page: import("@playwright/test").Page) => page.evaluate(() => ({ h: new Date().getUTCHours(), t: Date.now() }));

test.describe("e2e 固定瀏覽器時刻", () => {
  test("browserTime：02:00～03:59 退回同日 01:00，其餘時間不動", () => {
    const at = (t: string) => browserTime(new Date(`2026-10-29T${t}Z`)).toISOString();
    expect(at("02:00:00")).toBe("2026-10-29T01:00:00.000Z");
    expect(at("02:30:00")).toBe("2026-10-29T01:00:00.000Z");
    expect(at("03:59:59")).toBe("2026-10-29T01:00:00.000Z");
    expect(at("01:59:59")).toBe("2026-10-29T01:59:59.000Z");
    expect(at("04:00:00")).toBe("2026-10-29T04:00:00.000Z");
    expect(at("12:34:56")).toBe("2026-10-29T12:34:56.000Z");
  });

  test("預設 context：時刻不在 02～03 點、與實際今天同一天、且時間照常流動（Date 與實際時間的差固定）", async ({ page }) => {
    await page.goto("/zh-Hant");
    const a = await nowHour(page);
    expect([2, 3]).not.toContain(a.h);
    await page.waitForTimeout(300);
    const b = await nowHour(page);
    expect(b.t - a.t).toBeGreaterThanOrEqual(250);
    // 日期仍是實際今天（與伺服器一致）
    expect(new Date(a.t).toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  test("測試中以 browser.newContext() 另開的 context 同樣固定", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/zh-Hant");
    expect([2, 3]).not.toContain((await nowHour(page)).h);
    await ctx.close();
  });

  test("一般頁面不會自動解鎖 night-owl：選單只有 3 個選項、沒有解鎖紀錄", async ({ page }) => {
    await page.goto("/zh-Hant");
    const panel = await openHeaderMenu(page, "theme");
    await expect(panel.locator("[data-theme-option]")).toHaveCount(3);
    await expect(panel.locator('[data-theme-option="night-owl"]')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem("sok-unlocks") ?? "[]");
    expect(stored).not.toContain("night-owl");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "night-owl");
  });
});
