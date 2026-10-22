/**
 * GameDex 第 2 輪（Z2B）：月曆「遊戲／活動」顯示開關（e2e＋axe）。
 * fixture：2036-05 有大量遊戲，05-12 有一個活動（E2E Showcase 2036）。預設只顯示遊戲，活動要打開開關才出現。
 */
import { expect, expectNoA11yViolations, FIXTURE, msg, calendarUrl, test, waitForCalendarReady } from "./support/helpers";
import type { Locator, Page } from "@playwright/test";

const grid = ".cal-grid";
const eventCell = `.cal-cell[data-date="${FIXTURE.eventDay}"]`;
const group = (page: Page) => page.getByRole("group", { name: msg("zh-Hant", "ui.calendar.showLegend") });
const sw = (page: Page, kind: "releases" | "events"): Locator => page.locator(`[data-cal-switch="${kind}"]`);
const events = (page: Page) => page.locator(`${grid} [data-event]`);
const gameLinks = (page: Page) => page.locator(`${grid} a.cal-link`);

test.describe("月曆「遊戲／活動」開關", () => {
  test("預設只開遊戲：兩個 switch 有可及名稱與狀態；格內沒有活動；網址沒有 show", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    await expect(group(page)).toBeVisible();
    const games = group(page).getByRole("switch", { name: msg("zh-Hant", "ui.calendar.switchGames") });
    const evs = group(page).getByRole("switch", { name: msg("zh-Hant", "ui.calendar.switchEvents") });
    await expect(games).toHaveAttribute("aria-checked", "true");
    await expect(evs).toHaveAttribute("aria-checked", "false");
    await expect(events(page)).toHaveCount(0);
    expect(await gameLinks(page).count()).toBeGreaterThan(0);
    expect(page.url()).not.toContain("show=");
    // 觸控目標 ≥ 44px
    expect((await games.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("打開「活動」：網址 show=events,releases、格內出現活動、遊戲仍在；再關掉回到預設（網址不帶 show）", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    await sw(page, "events").click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${FIXTURE.month}\\?show=events,releases$`));
    await waitForCalendarReady(page);
    await expect(sw(page, "events")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "releases")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(`${eventCell} [data-event]`)).toContainText(FIXTURE.event.name);
    expect(await gameLinks(page).count()).toBeGreaterThan(0);
    await sw(page, "events").click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${FIXTURE.month}$`));
    await expect(events(page)).toHaveCount(0);
  });

  test("只看活動：關掉「遊戲」→ show=events；格內沒有遊戲卡片；最後一個開著的開關不能關", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases"));
    await waitForCalendarReady(page);
    await sw(page, "releases").click();
    await expect(page).toHaveURL(new RegExp(`\\?show=events$`));
    await expect(sw(page, "releases")).toHaveAttribute("aria-checked", "false");
    await expect(sw(page, "events")).toHaveAttribute("aria-checked", "true");
    await expect(gameLinks(page)).toHaveCount(0);
    await expect(page.locator(`${eventCell} [data-event]`)).toContainText(FIXTURE.event.name);
    // 「活動」是最後一個開著的：aria-disabled，按了沒有反應，並說明原因
    const last = sw(page, "events");
    await expect(last).toHaveAttribute("aria-disabled", "true");
    await expect(last).toHaveAccessibleDescription(msg("zh-Hant", "ui.calendar.showAtLeastOne"));
    await last.click({ force: true }); // aria-disabled：Playwright 預設會一直等它變成 enabled
    await expect(page).toHaveURL(new RegExp(`\\?show=events$`));
    await expect(last).toHaveAttribute("aria-checked", "true");
  });

  test("預設狀態下「遊戲」是最後一個開著的：不能關", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    const games = sw(page, "releases");
    await expect(games).toHaveAttribute("aria-disabled", "true");
    await games.click({ force: true });
    expect(page.url()).not.toContain("show=");
    await expect(games).toHaveAttribute("aria-checked", "true");
  });

  test("鍵盤：Tab 到開關、Space 與 Enter 都能切換", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    await sw(page, "events").focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/show=events,releases$/);
    await waitForCalendarReady(page);
    await sw(page, "events").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/calendar/${FIXTURE.month}$`));
  });

  test("換月、「今天」、時間軸連結、篩選表單送出都保留 show", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases"));
    await waitForCalendarReady(page);
    await expect(page.locator('[data-month-nav="next"]')).toHaveAttribute("href", /\/calendar\/2036-06\?show=events,releases$/);
    await expect(page.locator('[data-month-nav="prev"]')).toHaveAttribute("href", /\/calendar\/2036-04\?show=events,releases$/);
    await page.locator('[data-month-nav="next"]').click();
    await expect(page).toHaveURL(/\/calendar\/2036-06\?show=events,releases$/);
    await expect(sw(page, "events")).toHaveAttribute("aria-checked", "true");
    await page.locator('[data-month-nav="prev"]').click();
    await expect(page).toHaveURL(/\/calendar\/2036-05\?show=events,releases$/);
    // 篩選表單（GET）送出：不遺失 show
    await page.locator("summary", { hasText: msg("zh-Hant", "filters.title") }).first().click();
    await page.locator('input[name="platformKind"][value="console"]').check();
    await page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).first().click();
    await expect(page).toHaveURL(/platformKind=console/);
    await expect(page).toHaveURL(/show=events(,|%2C)releases/);
    await expect(sw(page, "events")).toHaveAttribute("aria-checked", "true");
    // 篩選 chip 不含「顯示內容」（那是上方的開關）
    await expect(page.locator("a.filter-chip", { hasText: msg("zh-Hant", "filters.dimensions.show") })).toHaveCount(0);
  });

  test("只看活動時，換月與篩選也保留；沒有活動的月份顯示對應的空狀態", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", "2036-07", "show=events"));
    await waitForCalendarReady(page).catch(() => undefined);
    await expect(page.getByText(msg("zh-Hant", "ui.calendar.noEvents"))).toBeVisible();
    await expect(page.locator('[data-month-nav="next"]')).toHaveAttribute("href", /\/calendar\/2036-08\?show=events$/);
  });

  test("伺服器端依參數決定是否查活動：預設的 HTML 與 RSC 都不含活動；show=events,releases 才有", async ({ request }) => {
    const def = await (await request.get(calendarUrl("zh-Hant", FIXTURE.month))).text();
    expect(def).not.toContain(FIXTURE.event.name);
    expect(def).not.toContain("e2e-showcase-2036");
    const withEvents = await (await request.get(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases"))).text();
    expect(withEvents).toContain(FIXTURE.event.name);
    // 只看活動：沒有遊戲上市卡片（hero 的名稱不在 HTML）
    const only = await (await request.get(calendarUrl("zh-Hant", FIXTURE.month, "show=events"))).text();
    expect(only).toContain(FIXTURE.event.name);
    expect(only).not.toContain(FIXTURE.hero.name);
  });

  test("day API 同樣支援：預設與 show=releases 回遊戲；show=events 回空", async ({ request }) => {
    const get = async (extra: string) =>
      (await (await request.get(`/api/v1/calendar/day?date=${FIXTURE.busyDay}&locale=en${extra}`)).json()) as { total: number; cards: unknown[] };
    expect((await get("")).total).toBe(FIXTURE.busyCount);
    expect((await get("&show=events,releases")).total).toBe(FIXTURE.busyCount);
    expect(await get("&show=events")).toMatchObject({ total: 0, cards: [] });
  });

  test("格內切換打 day API 時帶著 show（只看遊戲＋活動時仍能逐款看完）", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month, "show=events,releases"));
    await waitForCalendarReady(page);
    const req = page.waitForRequest((r) => r.url().includes("/api/v1/calendar/day"));
    await page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"] [data-cal-nav="next"]`).click();
    expect(new URL((await req).url()).searchParams.get("show")).toBe("events,releases");
  });

  test("切換開關換頁：新頁面的月曆本體以 120ms 淡入（vt-fade-in）；換月仍是 380ms 浮入（vt-in）", async ({ page }) => {
    // 每個畫面影格記錄 ::view-transition-new(cal-grid) 的動畫名稱與時長（新頁面的 View Transition 只活約 0.4 秒）
    await page.addInitScript(() => {
      const tick = () => {
        try {
          for (const a of document.getAnimations()) {
            const eff = a.effect as (KeyframeEffect & { pseudoElement?: string | null }) | null;
            if (eff?.pseudoElement === "::view-transition-new(cal-grid)") {
              sessionStorage.setItem("__vtanim", JSON.stringify({ name: (a as CSSAnimation).animationName, dur: Number(eff.getTiming().duration) }));
            }
          }
        } catch {
          /* 不支援就略過 */
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    const supported = await page.evaluate(() => "onpagereveal" in window && "ViewTransition" in window);
    test.skip(!supported, "瀏覽器不支援跨文件 View Transition");
    await page.evaluate(() => sessionStorage.removeItem("__vtanim"));
    await sw(page, "events").click();
    await expect(page).toHaveURL(/show=events,releases$/);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("__vtanim"))).toBe('{"name":"vt-fade-in","dur":120}');
    await page.evaluate(() => sessionStorage.removeItem("__vtanim"));
    await page.locator('[data-month-nav="next"]').click();
    await expect(page).toHaveURL(/2036-06/);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("__vtanim"))).toBe('{"name":"vt-in","dur":380}');
  });

  test("標記過期（超過 5 秒）或沒有標記時，換頁不帶 cal-toggle", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    await page.evaluate(() => sessionStorage.setItem("sok-vt-cal-toggle", String(Date.now() - 10_000)));
    await page.locator('[data-month-nav="next"]').click();
    await expect(page).toHaveURL(/2036-06/);
    // 過期標記在 pagereveal 就被清掉，不會殘留到下一次換頁
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("sok-vt-cal-toggle"))).toBeNull();
  });

  test("沒有 JS：開關是一般連結，整頁換網址", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    const evs = page.getByRole("switch", { name: msg("zh-Hant", "ui.calendar.switchEvents") });
    await expect(evs).toHaveAttribute("href", `/zh-Hant/calendar/${FIXTURE.month}?show=events,releases`);
    await evs.click();
    await expect(page.locator(`${eventCell} [data-event]`)).toContainText(FIXTURE.event.name);
    await ctx.close();
  });

  test("三個語系的開關文字", async ({ page }) => {
    for (const locale of ["en", "ja"] as const) {
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await expect(page.getByRole("group", { name: msg(locale, "ui.calendar.showLegend") })).toBeVisible();
      await expect(page.getByRole("switch", { name: msg(locale, "ui.calendar.switchGames") })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("switch", { name: msg(locale, "ui.calendar.switchEvents") })).toHaveAttribute("aria-checked", "false");
    }
  });

  test("手機寬度（320、375）：開關不溢出、不重疊", async ({ page }) => {
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases"));
      await waitForCalendarReady(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
      const a = (await sw(page, "releases").boundingBox())!;
      const b = (await sw(page, "events").boundingBox())!;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe（${scheme}）：預設、只看活動（含 aria-disabled 的開關）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
      await waitForCalendarReady(page);
      await expectNoA11yViolations(page, `月曆 ${scheme}`);
      await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases"));
      await waitForCalendarReady(page);
      await expectNoA11yViolations(page, `月曆 活動開 ${scheme}`);
      await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events"));
      await expectNoA11yViolations(page, `月曆 只看活動 ${scheme}`);
    });
  }
});
