/**
 * header 左上角品牌文字的「拉霸機」換字（brand-roll.tsx）：
 * - 換頁後逐字上下滾動，整體 ≤ 0.5 秒，結束後是純文字、aria-label 與最終文字一致
 * - 第一次進站、重新整理同一頁：不播放
 * - prefers-reduced-motion：直接換字，不建立字格
 * - 滾動中的字格寬度連續變化（開始 ≈ 舊字寬、結束 = 新字寬，不超出兩者範圍）
 */
import { expect, expectNoA11yViolations, openMainNav, test } from "./support/helpers";
import type { Page } from "@playwright/test";

interface Log {
  t: number;
  state: string;
  slots: number;
  width: number;
}

/** 在每個文件載入前掛上觀察器：記錄 data-brand-roll 的變化、字格數與品牌寬度。 */
async function installBrandLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __brandLog: unknown[] };
    w.__brandLog = [];
    const snap = () => {
      const el = document.querySelector<HTMLElement>(".hd-brand-text");
      if (!el) return;
      const state = el.getAttribute("data-brand-roll") ?? "";
      const last = w.__brandLog[w.__brandLog.length - 1] as { state: string } | undefined;
      const row = { t: performance.now(), state, slots: el.querySelectorAll("[data-roll-slot]").length, width: document.querySelector(".hd-brand")?.getBoundingClientRect().width ?? 0 };
      if (!last || last.state !== state) w.__brandLog.push(row);
    };
    const start = () => {
      new MutationObserver(snap).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-brand-roll"] });
      snap();
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
}

const readLog = (page: Page): Promise<Log[]> => page.evaluate(() => (window as unknown as { __brandLog: Log[] }).__brandLog);
const brandText = (page: Page) => page.locator(".hd-brand-text");

async function gotoViaNav(page: Page, name: RegExp): Promise<void> {
  const nav = await openMainNav(page, "en");
  await nav.getByRole("link", { name }).click();
}

test.describe("品牌文字拉霸機", () => {
  test("換頁時逐字滾動 ≤ 0.5 秒，結束後是純文字且 aria-label 一致", async ({ page }) => {
    await page.goto("/en/calendar");
    await expect(brandText(page)).toHaveText("GameCalendar");
    // 第一次進站：不播放
    await expect(brandText(page)).toHaveAttribute("data-brand-roll", "idle");
    await expect(page.locator(".hd-roll-slot")).toHaveCount(0);

    await installBrandLog(page);
    await gotoViaNav(page, /timeline/i);
    await expect(page).toHaveURL(/\/en\/timeline/);
    await expect(brandText(page)).toHaveText("GameTimeline");
    await expect(page.locator(".hd-brand")).toHaveAttribute("aria-label", "GameTimeline");
    await expect(brandText(page)).toHaveAttribute("data-roll-ms", /^\d+$/, { timeout: 3000 });
    await expect(brandText(page)).toHaveAttribute("data-brand-roll", "idle");

    const log = await readLog(page);
    const rolling = log.find((l) => l.state === "rolling");
    expect(rolling, "應該觀察到 rolling 狀態").toBeTruthy();
    // 字格數 = 舊字（GameCalendar 12）與新字（GameTimeline 12）的較長者
    expect(rolling!.slots).toBe(12);
    const ms = Number(await brandText(page).getAttribute("data-roll-ms"));
    expect(ms).toBeGreaterThan(100);
    expect(ms).toBeLessThanOrEqual(400); // 動畫本身的時間軸（第一個字格開始 → 最後一個字格停下；理論值 280）
    // 牆鐘時間另外量（含 hydration 等主執行緒忙碌的開始延遲）：負載下只做粗略上限，避免 CI 抖動
    expect(Number(await brandText(page).getAttribute("data-roll-wall"))).toBeLessThan(1500);
    await expect(page.locator(".hd-roll-slot")).toHaveCount(0);
  });

  test("不等長字串：字格數取較長者，寬度不超出新舊文字寬度，結束寬度 = 直接載入的寬度", async ({ page }) => {
    // GameCalendar（12）→ GameDex（7）：逐步縮短
    await page.goto("/en/calendar");
    const oldW = await page.locator(".hd-brand").evaluate((el) => el.getBoundingClientRect().width);
    await installBrandLog(page);
    await page.locator("a.hd-brand").click(); // 品牌連結回首頁
    await expect(page).toHaveURL(/\/en$/);
    await expect(brandText(page)).toHaveAttribute("data-roll-ms", /^\d+$/, { timeout: 3000 });
    const log = await readLog(page);
    const rolling = log.find((l) => l.state === "rolling");
    expect(rolling).toBeTruthy();
    expect(rolling!.slots).toBe(12);
    const endW = await page.locator(".hd-brand").evaluate((el) => el.getBoundingClientRect().width);
    expect(endW).toBeLessThan(oldW);
    // 重新整理同一頁（記憶的品牌 = 目前品牌）：不播放，寬度與動畫結束時相同
    await page.reload();
    await expect(brandText(page)).toHaveText("GameDex");
    await expect(page.locator(".hd-roll-slot")).toHaveCount(0);
    const freshW = await page.locator(".hd-brand").evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(freshW - endW)).toBeLessThanOrEqual(1);
    // 滾動中的寬度（log 的 rolling 列）介於新舊寬度之間
    expect(rolling!.width).toBeLessThanOrEqual(oldW + 1);
    expect(rolling!.width).toBeGreaterThanOrEqual(endW - 1);
  });

  test("換頁（含品牌滾動）後的畫面沒有 axe 違規", async ({ page }) => {
    await page.goto("/en/calendar");
    await gotoViaNav(page, /ratings/i);
    await expect(page).toHaveURL(/\/en\/ratings/);
    await expectNoA11yViolations(page, "ratings after brand roll");
  });

  test("prefers-reduced-motion：直接換字，不建立字格", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en/calendar");
    await installBrandLog(page);
    await gotoViaNav(page, /timeline/i);
    await expect(page).toHaveURL(/\/en\/timeline/);
    await expect(brandText(page)).toHaveText("GameTimeline");
    await expect(page.locator(".hd-brand")).toHaveAttribute("aria-label", "GameTimeline");
    const log = await readLog(page);
    expect(log.some((l) => l.state === "rolling" || l.slots > 0)).toBe(false);
    expect(await brandText(page).getAttribute("data-roll-ms")).toBeNull();
  });
});
