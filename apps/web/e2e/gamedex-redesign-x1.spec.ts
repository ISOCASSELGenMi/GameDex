/**
 * GameDex 改版第 3 段（X1）：視覺語言基礎＋月曆重做（一日一格一款、格內左右切換、按需載入、效能）。
 * 固定月份 2036-05（fixture）：busyDay 2036-05-08 有 8 款（Busy Day Game 01~08，03 是 Early Access）、
 * 2036-05-15 只有主角一款、2036-05-22 有 Delayed Dragon（延期）與 Removed Rocket（來源待確認）兩款、2036-05-12 有活動。
 */
import type { Page } from "@playwright/test";
import { FIXTURE, LOCALES, calendarUrl, expect, expectNoA11yViolations, msg, test, waitForCalendarReady, type TestLocale } from "./support/helpers";

const MOBILE = { width: 375, height: 812 };
const cell = (iso: string) => `.cal-cell[data-date="${iso}"]`;
const busy = cell(FIXTURE.busyDay);
const name = (n: number) => `Busy Day Game ${String(n).padStart(2, "0")}`;

/** 與頁面相同的日期文字（月 日 星期；UTC）。 */
const dayText = (locale: TestLocale, iso: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** 按 Tab 直到焦點落在 selector（最多 4 次，且必須仍在同一格內）。 */
async function tabWithinCell(page: Page, selector: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    if (await page.locator(selector).evaluate((el) => el === document.activeElement)) return;
    expect(await page.evaluate(() => !!document.activeElement?.closest(".cal-cell")), "焦點仍在同一格內").toBe(true);
  }
  throw new Error(`Tab 4 次仍未到 ${selector}`);
}

function dayRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/calendar/day") urls.push(r.url());
  });
  return urls;
}

test.describe("月曆：一日一格一款", () => {
  test("每格最多一個封面連結；伺服器 HTML 只送每天第一款；沒有遊戲的日期是空格", async ({ page, request }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const cells = page.locator(".cal-cell");
    expect(await cells.count()).toBe(31);
    for (const c of await cells.all()) expect(await c.locator("a.cal-link").count()).toBeLessThanOrEqual(1);
    await expect(page.locator(`${busy} a.cal-link`)).toHaveCount(1);
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(1));
    // 8 款的那天，其餘 7 款不在頁面上
    await expect(page.getByText(name(2), { exact: true })).toHaveCount(0);
    // 空日期：沒有連結、可及名稱說明沒有遊戲
    const emptyDay = cell(`${FIXTURE.month}-03`);
    await expect(page.locator(`${emptyDay} a.cal-link`)).toHaveCount(0);
    await expect(page.locator(emptyDay)).toHaveAttribute("aria-label", msg("en", "a11y.dayCellEmpty", { date: dayText("en", `${FIXTURE.month}-03`) }));

    // 伺服器 HTML（不執行 JS）
    const res = await request.get(calendarUrl("en", FIXTURE.month));
    const html = await res.text();
    expect(html).toContain(name(1));
    expect(html).not.toContain(name(2));
    expect(html).not.toContain(name(8));
  });

  test("同日多款：群組名稱含款數；第一款完整（封面連結、名稱、平台、標籤）", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    await expect(page.locator(busy)).toHaveAttribute("role", "group");
    await expect(page.locator(busy)).toHaveAttribute("aria-label", msg("en", "a11y.dayCell", { date: dayText("en", FIXTURE.busyDay), count: FIXTURE.busyCount }));
    const hero = page.locator(`${cell(FIXTURE.multiPlatformDay)} a.cal-link`);
    await expect(hero).toHaveAttribute("href", `/en/games/${FIXTURE.hero.slug}`);
    await expect(hero.locator(".cal-name")).toHaveText(FIXTURE.hero.name);
    await expect(hero.locator(".cal-chip")).toHaveCount(3); // 三個平台都在同一張卡上
    await expect(page.locator(`${cell(FIXTURE.multiPlatformDay)} [data-cal-nav]`)).toHaveCount(0); // 只有一款：沒有切換鈕
    await expect(page.locator(`${cell("2036-05-22")} a.cal-link [data-tag="status"]`)).toHaveText(msg("en", "enums.releaseStatus.delayed"));
  });

  test("模糊日期（月精度）在「本月未定日」，不在格子裡；活動有圖示＋文字", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, "show=events,releases")); // 月曆預設不顯示活動（Z2B）
    await expect(page.locator("section.undated h2")).toHaveText(msg("zh-Hant", "ui.calendar.undatedThisMonth"));
    await expect(page.locator("section.undated").getByText(FIXTURE.monthPrecision.name)).toBeVisible();
    await expect(page.locator(".cal-grid").getByText(FIXTURE.monthPrecision.name)).toHaveCount(0);
    const ev = page.locator(`${cell(FIXTURE.eventDay)} [data-event]`);
    await expect(ev).toContainText(FIXTURE.event.name);
    await expect(ev.locator(".ev-tag")).toHaveText(msg("zh-Hant", "ui.calendar.event"));
    await expect(ev.locator(".ev-tag .ev-ico")).toHaveCount(1);
  });
});

test.describe("月曆：格內切換", () => {
  test("按鈕切換：第一次打 day API、之後不再打；點點／計數、live region、按鈕名稱同步", async ({ page }) => {
    const reqs = dayRequests(page);
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    expect(reqs).toHaveLength(0); // 沒互動就不載入
    const next = page.locator(`${busy} [data-cal-nav="next"]`);
    const prev = page.locator(`${busy} [data-cal-nav="prev"]`);
    await expect(next).toHaveAttribute("aria-label", msg("en", "a11y.calendarNextGame", { index: 2, total: 8 }));
    await expect(prev).toHaveAttribute("aria-label", msg("en", "a11y.calendarPrevGame", { index: 8, total: 8 }));
    // 款數 8 > 6 → 文字計數
    await expect(page.locator(`${busy} [data-cal-pos]`)).toHaveText("1 / 8");

    const [res] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/calendar/day"), next.click()]);
    expect(res.status()).toBe(200);
    const url = new URL(res.url());
    expect(url.searchParams.get("date")).toBe(FIXTURE.busyDay);
    expect(url.searchParams.get("locale")).toBe("en");
    const body = (await res.json()) as { date: string; total: number; cards: { n: string }[] };
    expect(body.total).toBe(8);
    expect(body.cards.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(name));

    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await expect(page.locator(`${busy} a.cal-link`)).toHaveCount(1);
    await expect(page.locator(`${busy} [data-cal-pos]`)).toHaveText("2 / 8");
    await expect(page.locator(`${busy} [data-cal-live]`)).toHaveText(msg("en", "a11y.calendarCurrentGame", { name: name(2), index: 2, total: 8 }));
    await expect(next).toHaveAttribute("aria-label", msg("en", "a11y.calendarNextGame", { index: 3, total: 8 }));
    await expect(prev).toHaveAttribute("aria-label", msg("en", "a11y.calendarPrevGame", { index: 1, total: 8 }));

    // 第三款是 Early Access：階段標籤
    await next.click();
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(3));
    await expect(page.locator(`${busy} [data-tag="stage"]`)).toHaveText(msg("en", "enums.releaseStage.early_access"));
    await prev.click();
    await prev.click();
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(1));
    // 繞回另一端
    await prev.click();
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(8));
    await expect(page.locator(`${busy} [data-cal-pos]`)).toHaveText("8 / 8");
    expect(reqs, "同一格只打一次 day API").toHaveLength(1);
  });

  test("款數少用點點：兩款的那天兩個點、目前的點會移動", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const two = cell("2036-05-22");
    await expect(page.locator(`${two} .cal-dot`)).toHaveCount(2);
    await expect(page.locator(`${two} .cal-dot[data-on="true"]`)).toHaveCount(1);
    expect(await page.locator(`${two} .cal-dot`).evaluateAll((els) => els.findIndex((e) => e.getAttribute("data-on") === "true"))).toBe(0);
    await expect(page.locator(`${two} .cal-name`)).toHaveText("Delayed Dragon");
    await page.locator(`${two} [data-cal-nav="next"]`).click();
    await expect(page.locator(`${two} .cal-name`)).toHaveText("Removed Rocket");
    expect(await page.locator(`${two} .cal-dot`).evaluateAll((els) => els.findIndex((e) => e.getAttribute("data-on") === "true"))).toBe(1);
    await expect(page.locator(`${two} [data-tag="warn"]`)).toHaveText(msg("en", "ui.release.sourceUnconfirmed"));
  });

  test("鍵盤：Tab 進格（整格是一個停駐點）、左右鍵切換；進格後內部控制項才進 Tab 順序", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const group = page.locator(busy);
    // 進格之前：內部連結與按鈕不在 Tab 順序
    await expect(page.locator(`${busy} a.cal-link`)).toHaveAttribute("tabindex", "-1");
    await expect(page.locator(`${busy} [data-cal-nav="next"]`)).toHaveAttribute("tabindex", "-1");
    // 從主要內容 Tab 到這一格
    await page.locator("main#main").focus();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await group.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(group).toBeFocused();
    const outline = await group.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);

    await page.keyboard.press("ArrowRight");
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(3));
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await expect(group).toBeFocused(); // 切換不搶走焦點
    await expect(page.locator(`${busy} [data-cal-live]`)).toHaveText(msg("en", "a11y.calendarCurrentGame", { name: name(2), index: 2, total: 8 }));

    // 進格之後，Tab 依序：封面連結 → 上一款 → 下一款（按鈕上也能用左右鍵）；Shift+Tab 回到封面連結
    await expect(page.locator(`${busy} [data-cal-nav="prev"]`)).not.toHaveAttribute("tabindex", "-1");
    // （accounts 啟用時，連結與切換鈕之間還有追蹤按鈕，所以用「最多按幾次 Tab」到達）
    await page.keyboard.press("Tab");
    await expect(page.locator(`${busy} a.cal-link`)).toBeFocused();
    await tabWithinCell(page, `${busy} [data-cal-nav="prev"]`);
    await page.keyboard.press("Tab");
    await expect(page.locator(`${busy} [data-cal-nav="next"]`)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(3));
    for (let i = 0; i < 4 && !(await page.locator(`${busy} a.cal-link`).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`${busy} a.cal-link`)).toBeFocused();
    // 按 Enter：開側邊預覽卡（焦點移入）；Esc 關閉並回到連結
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.side-sheet");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#sheet-title")).toHaveText(name(3));
    await expect(page.locator("#sheet-title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(`${busy} a.cal-link`)).toBeFocused();
  });

  test("篩選一致：day API 用與頁面相同的篩選（PS5 只剩 4 款）", async ({ page }) => {
    const reqs = dayRequests(page);
    await page.goto(calendarUrl("en", FIXTURE.month, `platform=${FIXTURE.platformPs5}`));
    await waitForCalendarReady(page);
    await expect(page.locator(busy)).toHaveAttribute("data-count", "4");
    await expect(page.locator(`${busy} .cal-dot`)).toHaveCount(4);
    const next = page.locator(`${busy} [data-cal-nav="next"]`);
    const names: string[] = [await page.locator(`${busy} .cal-name`).innerText()];
    for (let i = 0; i < 3; i++) {
      await next.click();
      await expect(page.locator(`${busy} .cal-name`)).not.toHaveText(names[names.length - 1]!);
      names.push(await page.locator(`${busy} .cal-name`).innerText());
    }
    expect(names).toEqual([1, 2, 3, 4].map(name));
    expect(reqs).toHaveLength(1);
    expect(new URL(reqs[0]!).searchParams.get("platform")).toBe(FIXTURE.platformPs5);
  });

  test("觸控橫向滑動切換（手機寬）", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const viewport = page.locator(`${busy} .cal-viewport`);
    const swipe = (dx: number, dy = 0) =>
      viewport.evaluate(
        (el, d) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const fire = (type: string, cx: number, cy: number) =>
            el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", clientX: cx, clientY: cy, isPrimary: true }));
          fire("pointerdown", x, y);
          fire("pointerup", x + d.dx, y + d.dy);
        },
        { dx, dy },
      );
    await swipe(-90);
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await swipe(90);
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(1));
    // 垂直滑動（捲動頁面）不切換
    await swipe(10, 120);
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(1));
  });

  test("day API 失敗：格內顯示錯誤與重試，重試成功後切換", async ({ page }) => {
    let fail = true;
    await page.route("**/api/v1/calendar/day**", async (route) => {
      if (fail) return route.fulfill({ status: 503, json: { error: "timeout" } });
      return route.continue();
    });
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    await page.locator(`${busy} [data-cal-nav="next"]`).click();
    const alert = page.locator(`${busy} [role="alert"]`);
    await expect(alert).toContainText(msg("en", "ui.calendar.dayLoadError"));
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(1));
    fail = false;
    await alert.getByRole("button", { name: msg("en", "ui.calendar.dayRetry") }).click();
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await expect(alert).toHaveCount(0);
  });

  test("沒有 JS：每格只有第一款的詳情連結，沒有切換鈕", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(calendarUrl("en", FIXTURE.month));
    await expect(page.locator(`${busy} a.cal-link`)).toHaveAttribute("href", "/en/games/e2e-busy-01");
    await expect(page.locator("[data-cal-nav]")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("月曆：今天與換月", () => {
  test("今天明顯標示（裝置日期）：外框、「今天」小標、aria-current=date", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2036-05-15T12:00:00"));
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await waitForCalendarReady(page);
    const today = page.locator(cell(FIXTURE.multiPlatformDay));
    await expect(today).toHaveClass(/is-today/);
    await expect(today).toHaveAttribute("aria-current", "date");
    await expect(today.locator(".cal-today-tag")).toHaveText(msg("zh-Hant", "a11y.today"));
    await expect(page.locator(".cal-cell.is-today")).toHaveCount(1);
    const outline = await today.locator(".cal-box").evaluate((el) => ({ w: parseFloat(getComputedStyle(el).outlineWidth), s: getComputedStyle(el).outlineStyle }));
    expect(outline.s).not.toBe("none");
    expect(outline.w).toBeGreaterThanOrEqual(2);
    await expectNoA11yViolations(page, "月曆 今天標示");
  });

  test("上／下個月：連結帶篩選、點擊換月；換月轉場樣式存在（View Transition，僅無減少動態偏好時）", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month, `platform=${FIXTURE.platformPs5}`));
    await waitForCalendarReady(page);
    await page.locator('a[data-month-nav="next"]').click();
    await expect(page).toHaveURL(new RegExp(`${calendarUrl("en", FIXTURE.nextMonth)}\\?platform=`));
    await expect(page.locator("h1")).toContainText("June 2036");
    await page.locator('a[data-month-nav="prev"]').click();
    await expect(page.locator("h1")).toContainText("May 2036");
    // 轉場規則：@view-transition 與 cal-grid 的名稱只出現在 no-preference 之下
    const info = await page.evaluate(() => {
      let rules = 0;
      const walk = (list: CSSRuleList) => {
        for (const r of Array.from(list)) {
          if (r.cssText.includes("view-transition")) rules++;
          if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          /* 跨來源樣式表 */
        }
      }
      return { rules, name: getComputedStyle(document.querySelector(".cal-wrap")!).viewTransitionName };
    });
    expect(info.rules).toBeGreaterThan(0);
    expect(info.name).toBe("cal-grid");
  });
});

test.describe("月曆：動態與減少動態偏好", () => {
  test("沒有偏好：切換時新的一款有滑入動畫", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const next = page.locator(`${busy} [data-cal-nav="next"]`);
    await next.click();
    await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
    await next.click(); // 已載入：同步切換
    const names = await page.evaluate((sel) => document.querySelector(`${sel} a.cal-link`)!.getAnimations().map((a) => (a as CSSAnimation).animationName), busy);
    expect(names).toContain("cal-in-next");
  });

  test.describe("prefers-reduced-motion: reduce", () => {
    test.use({ reducedMotion: "reduce" });

    test("功能照常、沒有滑入與位移／縮放動畫", async ({ page }) => {
      await page.goto(calendarUrl("en", FIXTURE.month));
      await waitForCalendarReady(page);
      const next = page.locator(`${busy} [data-cal-nav="next"]`);
      await next.click();
      await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
      await next.click();
      await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(3));
      const info = await page.evaluate((sel) => {
        const link = document.querySelector(`${sel} a.cal-link`)!;
        const box = document.querySelector(`${sel} .cal-box`)!;
        return {
          animations: link.getAnimations().map((a) => (a as CSSAnimation).animationName),
          animationName: getComputedStyle(link).animationName,
          boxTransition: parseFloat(getComputedStyle(box).transitionDuration),
          viewTransitionName: getComputedStyle(document.querySelector(".cal-wrap")!).viewTransitionName,
        };
      }, busy);
      expect(info.animations).toEqual([]);
      expect(info.animationName).toBe("none");
      expect(info.boxTransition).toBeLessThanOrEqual(0.001);
      expect(info.viewTransitionName).toBe("none");
      await page.locator(`${busy}`).hover();
      expect(await page.locator(`${busy} .cal-box`).evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    });
  });
});

test.describe("月曆：版面", () => {
  for (const width of [375, 320]) {
    test(`手機 ${width}px：沒有水平溢出、逐日清單只列有內容的日期、仍可切換`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
      await waitForCalendarReady(page);
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await expect(page.locator(".cal-weekdays")).toBeHidden();
      // 空日期（5/3）不佔位；有內容的日期可見
      await expect(page.locator(`.cal-day[data-date="${FIXTURE.month}-03"]`)).toBeHidden();
      await expect(page.locator(`.cal-day[data-date="${FIXTURE.busyDay}"]`)).toBeVisible();
      // 箭頭在觸控／窄螢幕永遠可見且不小於 24px
      const next = page.locator(`${busy} [data-cal-nav="next"]`);
      await next.scrollIntoViewIfNeeded();
      await expect(next).toBeVisible();
      const box = (await next.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
      await next.click();
      await expect(page.locator(`${busy} .cal-name`)).toHaveText(name(2));
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      // 日期與星期都看得到
      await expect(page.locator(`${busy} .cal-daynum`)).toContainText("8");
      await expect(page.locator(`${busy} .cal-daynum-wd`)).toBeVisible();
    });
  }

  test("桌機：7 欄、週標頭、一格封面滿版", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    await expect(page.locator(".cal-weekdays span")).toHaveCount(7);
    const xs = await page.locator(".cal-day").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(xs).toBe(7);
    const box = (await page.locator(`${busy} .cal-box`).boundingBox())!;
    const cover = (await page.locator(`${busy} .cal-cover`).boundingBox())!;
    expect(Math.abs(cover.width - box.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(cover.height - box.height)).toBeLessThanOrEqual(2);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("day API", () => {
  test("回應格式、公開快取標頭、無 Set-Cookie；錯誤參數 400", async ({ request }) => {
    const ok = await request.get(`/api/v1/calendar/day?date=${FIXTURE.busyDay}&locale=zh-Hant`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toMatch(/public/);
    expect(ok.headers()["cache-control"]).toMatch(/s-maxage=\d+/);
    expect(ok.headers()["set-cookie"]).toBeUndefined();
    const body = (await ok.json()) as { date: string; total: number; cards: { id: number; h: string; n: string; pc: string[]; tg: { k: string; l: string }[] }[] };
    expect(body.date).toBe(FIXTURE.busyDay);
    expect(body.total).toBe(FIXTURE.busyCount);
    expect(body.cards[0]!.h).toBe("/zh-Hant/games/e2e-busy-01");
    expect(body.cards[2]!.tg).toEqual([{ k: "stage", i: "early_access", l: msg("zh-Hant", "enums.releaseStage.early_access") }]);
    // 月精度的遊戲代表日是當月 1 日，但不屬於格子
    const first = await (await request.get(`/api/v1/calendar/day?date=${FIXTURE.month}-01&locale=en`)).json();
    expect(first.total).toBe(0);
    expect((await request.get(`/api/v1/calendar/day?date=nope&locale=en`)).status()).toBe(400);
    expect((await request.get(`/api/v1/calendar/day?date=${FIXTURE.busyDay}&locale=xx`)).status()).toBe(400);
    expect((await request.get(`/api/v1/calendar/day?date=2036-13-01&locale=en`)).status()).toBe(400);
    // show=events：不含上市
    const evOnly = await (await request.get(`/api/v1/calendar/day?date=${FIXTURE.busyDay}&locale=en&show=events`)).json();
    expect(evOnly.total).toBe(0);
  });
});

test.describe("效能：月曆頁 HTML 大小", () => {
  test("整月 HTML 遠小於舊版（fixture 月份）；三語都只送第一款", async ({ request }) => {
    for (const locale of LOCALES) {
      const res = await request.get(calendarUrl(locale, FIXTURE.month));
      const html = await res.text();
      expect(html.length, `${locale} HTML 大小`).toBeLessThan(250 * 1024);
      expect(html).not.toContain(name(5));
    }
  });
});

test.describe("視覺語言 token", () => {
  test("亮暗色都定義表面、陰影、圓角與動畫 token；按鈕不是膠囊", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const t = await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        const get = (n: string) => s.getPropertyValue(n).trim();
        const btn = getComputedStyle(document.querySelector("a.btn-secondary")!);
        const header = getComputedStyle(document.querySelector("header.site-header")!);
        return {
          tokens: ["--background", "--panel", "--surface", "--glass", "--shadow-1", "--shadow-2", "--shadow-3", "--radius-md", "--radius-lg", "--dur-2", "--ease-out"].map(get),
          btnRadius: parseFloat(btn.borderTopLeftRadius),
          btnHeight: parseFloat(btn.minHeight),
          headerPosition: header.position,
          headerBlur: header.backdropFilter,
          background: get("--background"),
        };
      });
      expect(t.tokens.every((v) => v !== ""), scheme).toBe(true);
      expect(t.btnRadius, "按鈕圓角小於高度的一半 → 非膠囊").toBeLessThan(t.btnHeight / 2);
      expect(t.headerPosition).toBe("sticky");
      expect(t.headerBlur).toContain("blur");
      // 不是米色／奶油色：藍色通道不低於紅色通道
      const hex = t.background.replace("#", "");
      const [r, , b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(b!, `${scheme} 背景色 ${t.background} 不可偏黃`).toBeGreaterThanOrEqual(r!);
    }
  });
});

test.describe("axe：新月曆", () => {
  for (const locale of LOCALES) {
    test(`亮色：桌機（含已切換的格）與手機（${locale}）`, async ({ page }) => {
      await page.goto(calendarUrl(locale, FIXTURE.month));
      await waitForCalendarReady(page);
      await expectNoA11yViolations(page, `${locale} 月曆 初始`);
      await page.locator(`${busy} [data-cal-nav="next"]`).click();
      await expect(page.locator(`${busy} [data-cal-pos]`)).toContainText("2");
      await page.locator(`${cell("2036-05-22")} [data-cal-nav="next"]`).click();
      await page.locator(`${busy}`).focus();
      await expectNoA11yViolations(page, `${locale} 月曆 切換後`);
      await page.setViewportSize(MOBILE);
      await expectNoA11yViolations(page, `${locale} 月曆 手機`);
    });
  }

  test.describe("深色", () => {
    test.use({ colorScheme: "dark" });
    for (const locale of ["zh-Hant", "en"] as const satisfies readonly TestLocale[]) {
      test(`桌機與手機（${locale}）`, async ({ page }) => {
        await page.goto(calendarUrl(locale, FIXTURE.month));
        await waitForCalendarReady(page);
        expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
        await page.locator(`${busy} [data-cal-nav="next"]`).click();
        await expect(page.locator(`${busy} [data-cal-pos]`)).toContainText("2");
        await expectNoA11yViolations(page, `${locale} 深色月曆`);
        await page.setViewportSize(MOBILE);
        await expectNoA11yViolations(page, `${locale} 深色月曆 手機`);
      });
    }
  });
});
