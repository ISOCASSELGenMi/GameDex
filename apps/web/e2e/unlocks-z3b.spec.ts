/**
 * GameDex 第 2 輪 Z3B：解鎖紀錄跨裝置同步與帳號頁「收藏與成就」。
 * 登入用 API；紀錄用 POST /api/v1/me/unlocks 寫入（等同同步器 push）。每個測試用自己的帳號。
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import { E2E_BASE_URL } from "./support/env";
import { FIXTURE, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";
import { api, apiLogin, gameIdBySlug, horizontalOverflow, signedInUser } from "./support/accounts";

const SHOTS = path.resolve(__dirname, "../../../../../agents/7/z3b-shots");
const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);
const at = "2026-06-01T00:00:00.000Z";
const rec = (type: string, key: string) => ({ type, key, at });
const COLLECTIBLES = ["cartridge", "floppy", "cd", "dvd", "bluray", "memory-card", "game-card", "cloud"];
const THEMES = ["sony-blue", "xbox-green", "nintendo-red", "eight-bit", "gold", "standby-purple", "arcade-neon", "night-owl", "coding"];

async function post(page: Page, unlocks: unknown[]) {
  return api<{ unlocks: Array<{ type: string; key: string; at: string }> }>(page, "POST", "/api/v1/me/unlocks", { unlocks });
}

async function openOverview(page: Page, locale: TestLocale) {
  await page.goto(`/${locale}/account`);
  const section = page.getByRole("region", { name: m(locale, "collection.title") });
  await expect(section).toBeVisible();
  await expect(section.getByRole("heading", { level: 3, name: m(locale, "collection.mediaTitle") })).toBeVisible();
  return section;
}

test.describe("帳號頁：收藏與成就", () => {
  test("部分收集：剪影與數量，未解鎖不洩漏名稱；亮／暗 axe；320px 不溢出", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "z3b-part");
    expect((await post(page, [rec("collectible", "cd"), rec("collectible", "cloud"), rec("theme", "sony-blue"), rec("achievement", "viewed-50-games")])).status).toBe(200);

    const section = await openOverview(page, locale);
    await expect(section.getByText(m(locale, "collection.mediaCount", { n: 2, total: 8 }))).toBeVisible();
    await expect(section.locator("[data-collectible]")).toHaveCount(8);
    await expect(section.locator('[data-collected="true"]')).toHaveCount(2);
    await expect(section.locator('[data-collected="false"]')).toHaveCount(6);
    await expect(section.locator('[data-collectible="cd"]')).toContainText(m(locale, "collection.media.cd"));
    // 未收集：只顯示「Not collected yet」，沒有名稱
    const locked = section.locator('[data-collectible="floppy"]');
    await expect(locked).toContainText(m(locale, "collection.notCollected"));
    await expect(locked).not.toContainText(m(locale, "collection.media.floppy"));
    // 主題與成就：已解鎖顯示名稱，其餘只有數量
    await expect(section.locator('[data-theme-unlocked="sony-blue"]')).toHaveText(m(locale, "collection.theme.sony-blue"));
    // 夜貓子彩蛋（凌晨 2～4 點）可能因測試執行時間自動解鎖：隱藏數量依畫面上實際已解鎖的主題數計算
    const themeCount = await section.locator("[data-theme-unlocked]").count();
    expect(themeCount).toBeGreaterThanOrEqual(1);
    await expect(section.getByText(m(locale, "collection.themesHidden", { n: 9 - themeCount }))).toBeVisible();
    await expect(section.locator('[data-achievement-unlocked="viewed-50-games"]')).toHaveText(m(locale, "collection.achievement.viewed-50-games"));
    await expect(section.getByText(m(locale, "collection.achievementsHidden", { n: 4 }))).toBeVisible();
    const text = (await section.innerText()).toLowerCase();
    for (const key of ["first-follow", "first-list", "all-achievements", "coding"]) {
      expect(text).not.toContain(m(locale, `collection.${key === "coding" ? "theme" : "achievement"}.${key}`).toLowerCase());
    }
    await expect(section).toHaveAttribute("data-collection", "partial");
    await expect(section.locator("[data-collection-all]")).toHaveCount(0);

    await page.screenshot({ path: path.join(SHOTS, "collection-partial-light.png"), fullPage: true });
    await expectNoA11yViolations(page, "收藏與成就（部分，亮）", '[data-collection]');
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(section).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "collection-partial-dark.png"), fullPage: true });
    await expectNoA11yViolations(page, "收藏與成就（部分，暗）", '[data-collection]');

    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(section).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: path.join(SHOTS, "collection-partial-375.png"), fullPage: true });
  });

  test("全部收集：帳號資料成就（追蹤、清單、私人行事曆）＋all-achievements → 彩虹框線", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "z3b-full");
    // 帳號資料判定的三個成就：實際做一次
    const heroId = await gameIdBySlug(FIXTURE.hero.slug);
    expect((await api(page, "PUT", `/api/v1/follows/game/${heroId}`)).status).toBe(201);
    expect((await api(page, "POST", "/api/v1/lists", { name: "Z3B" })).status).toBe(201);
    expect((await api(page, "GET", "/api/v1/calendar/feeds")).status).toBe(200);

    // all-achievements 在其他成就不齊時被丟棄
    const early = await post(page, [rec("achievement", "all-achievements")]);
    expect(early.json.unlocks.map((r) => r.key)).not.toContain("all-achievements");

    const res = await post(page, [
      ...COLLECTIBLES.map((k) => rec("collectible", k)),
      ...THEMES.map((k) => rec("theme", k)),
      rec("achievement", "viewed-50-games"),
      rec("achievement", "all-achievements"),
    ]);
    expect(res.json.unlocks.filter((r) => r.type === "achievement").map((r) => r.key).sort()).toEqual(
      ["all-achievements", "first-follow", "first-ical-subscribe", "first-list", "viewed-50-games"],
    );

    const section = await openOverview(page, locale);
    await expect(section).toHaveAttribute("data-collection", "complete");
    await expect(section.locator("[data-collection-all]")).toHaveText(m(locale, "collection.allDone"));
    await expect(section.locator('[data-collected="true"]')).toHaveCount(8);
    await expect(section.locator("[data-theme-unlocked]")).toHaveCount(9);
    await expect(section.locator("[data-achievement-unlocked]")).toHaveCount(5);
    await expect(section.locator("[data-themes-hidden]")).toHaveCount(0);
    await expect(section.locator("[data-achievements-hidden]")).toHaveCount(0);
    expect(await section.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");

    await page.screenshot({ path: path.join(SHOTS, "collection-complete-light.png"), fullPage: true });
    await expectNoA11yViolations(page, "收藏與成就（全部，亮）", "[data-collection]");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(section).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "collection-complete-dark.png"), fullPage: true });
    await expectNoA11yViolations(page, "收藏與成就（全部，暗）", "[data-collection]");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: path.join(SHOTS, "collection-complete-375.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("沒有任何紀錄：空狀態文字，區塊仍可用", async ({ page }) => {
    const locale: TestLocale = "ja";
    await signedInUser(page, "z3b-empty");
    const section = await openOverview(page, locale);
    // 主題：夜貓子彩蛋可能在凌晨時段自動解鎖，所以只檢查「沒有東西」或「恰好一個夜貓子」其一
    const nightOwl = section.locator('[data-theme-unlocked="night-owl"]');
    if ((await nightOwl.count()) === 0) await expect(section.getByText(m(locale, "collection.themesNone"))).toBeVisible();
    await expect(section.getByText(m(locale, "collection.achievementsNone"))).toBeVisible();
    await expect(section.getByText(m(locale, "collection.mediaCount", { n: 0, total: 8 }))).toBeVisible();
  });

  test("未登入：不顯示收藏與成就", async ({ page }) => {
    await page.goto("/en/account");
    await expect(page.getByRole("heading", { name: m("en", "account.signedOutTitle") })).toBeVisible();
    await expect(page.locator("[data-collection]")).toHaveCount(0);
  });
});

test.describe("跨裝置同步", () => {
  test("瀏覽器 A 寫入 → 換一個瀏覽器 context 登入同帳號看到相同清單；帳號頁也看得到", async ({ page, browser }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "z3b-sync");
    await post(page, [rec("theme", "gold"), rec("collectible", "dvd")]);

    const ctx2 = await browser.newContext({ baseURL: E2E_BASE_URL, locale: "en-US" });
    try {
      const page2 = await ctx2.newPage();
      await apiLogin(page2, email);
      const list = await api<{ unlocks: Array<{ type: string; key: string }> }>(page2, "GET", "/api/v1/me/unlocks");
      expect(list.status).toBe(200);
      expect(list.json.unlocks.map((r) => `${r.type}:${r.key}`).filter((k) => k !== "theme:night-owl")).toEqual(["collectible:dvd", "theme:gold"]);
      const section = await openOverview(page2, locale);
      await expect(section.locator('[data-collectible="dvd"]')).toHaveAttribute("data-collected", "true");
      await expect(section.locator('[data-theme-unlocked="gold"]')).toBeVisible();
    } finally {
      await ctx2.close();
    }
  });

  test("登入後同步器已註冊：瀏覽器紀錄在載入頁面後被合併上傳（POST /api/v1/me/unlocks）", async ({ page }) => {
    const email = await signedInUser(page, "z3b-wire");
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem("sok-unlocks")) localStorage.setItem("sok-unlocks", JSON.stringify([{ type: "theme", key: "night-owl", at: "2026-06-02T00:00:00.000Z" }]));
      } catch {
        // 略過
      }
    });
    const posted = page.waitForRequest((r) => r.url().endsWith("/api/v1/me/unlocks") && r.method() === "POST", { timeout: 20_000 });
    await page.goto("/en/calendar");
    const body = (await posted).postDataJSON() as { unlocks: Array<{ type: string; key: string }> };
    expect(body.unlocks.map((r) => `${r.type}:${r.key}`)).toContain("theme:night-owl");
    // 伺服器端已有（輪詢到為止）
    await expect
      .poll(async () => (await api<{ unlocks: Array<{ key: string }> }>(page, "GET", "/api/v1/me/unlocks")).json.unlocks.map((r) => r.key))
      .toContain("night-owl");
    expect(email).toBeTruthy();
  });
});
