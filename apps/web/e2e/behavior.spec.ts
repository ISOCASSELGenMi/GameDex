/**
 * 行為（06 §月曆、§篩選、§多語系、§SEO 與快取；14 §前端；15 Phase 3a 完成標準）。
 * 一律以固定月份網址進入（fixture 2036-05），不依賴「今天」。
 */
import { FIXTURE, calendarUrl, expect, gameUrl, msg, test, waitForCalendarReady } from "./support/helpers";

const MOBILE = { width: 375, height: 812 };
const desktop = ".cal-desktop";
const cellOf = (iso: string) => `${desktop} td[data-date="${iso}"]`;

test.describe("月曆", () => {
  test("一款多平台遊戲在月曆只出現一次（桌機格子與手機議程）", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    const cards = page.locator(`${desktop} a.card`, { hasText: FIXTURE.hero.name });
    await expect(cards).toHaveCount(1);
    await expect(page.locator(`${cellOf(FIXTURE.multiPlatformDay)} a.card`, { hasText: FIXTURE.hero.name })).toHaveCount(1);
    // 三個平台都在同一張卡上
    await expect(cards.first().locator(".chip")).toHaveCount(3);

    await page.setViewportSize(MOBILE);
    await expect(page.locator(`.cal-mobile [data-agenda-day="${FIXTURE.multiPlatformDay}"] a.card`, { hasText: FIXTURE.hero.name })).toHaveCount(1);
  });

  test("超過上限的那天出現「＋N」，點開能看到全部", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const cell = page.locator(cellOf(FIXTURE.busyDay));
    await expect(cell.locator(".cell-list a.card")).toHaveCount(3);
    const more = cell.locator("summary[data-day-more]");
    await expect(more).toHaveText(msg("en", "ui.calendar.moreItems", { count: FIXTURE.busyCount - 3 }));
    // 格子的 aria-label 報出當天總數
    await expect(cell).toHaveAttribute("aria-label", new RegExp(String(FIXTURE.busyCount)));

    await more.click();
    const dialog = page.locator("dialog.side-sheet");
    await expect(dialog).toBeVisible();
    const entries = dialog.locator("button.sheet-entry");
    await expect(entries).toHaveCount(FIXTURE.busyCount);
    for (let i = 1; i <= FIXTURE.busyCount; i++) {
      await expect(dialog.getByText(`Busy Day Game ${String(i).padStart(2, "0")}`, { exact: true })).toBeVisible();
    }
  });

  test("沒有 JS 時「＋N」原地展開、卡片是詳情連結", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(calendarUrl("en", FIXTURE.month));
    const cell = page.locator(cellOf(FIXTURE.busyDay));
    await cell.locator("summary[data-day-more]").click();
    await expect(cell.locator("details.cell-more a[href]")).toHaveCount(FIXTURE.busyCount - 3);
    await expect(page.locator(`${desktop} a.card`, { hasText: FIXTURE.hero.name })).toHaveAttribute("href", gameUrl("en", FIXTURE.hero.slug));
    await ctx.close();
  });

  test("模糊日期（月精度）在「本月未定日」，不在格子裡", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    const undated = page.locator("section.undated");
    await expect(undated.locator("h2")).toHaveText(msg("zh-Hant", "ui.calendar.undatedThisMonth"));
    await expect(undated.getByText(FIXTURE.monthPrecision.name)).toBeVisible();
    await expect(page.locator(desktop).getByText(FIXTURE.monthPrecision.name)).toHaveCount(0);
  });

  test("手機寬度顯示議程式清單、沒有水平捲動", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    await expect(page.locator(desktop)).toBeHidden();
    const agenda = page.locator(".cal-mobile section.agenda");
    await expect(agenda).toBeVisible();
    await expect(agenda.locator("section.agenda-day h3").first()).toBeVisible();
    // 熱門的一天：議程顯示 5 張，其餘收在「＋N」
    const busy = agenda.locator(`[data-agenda-day="${FIXTURE.busyDay}"]`);
    await expect(busy.locator("ul.agenda-list > li")).toHaveCount(5);
    await expect(busy.locator("details.agenda-more > summary")).toHaveText(msg("zh-Hant", "ui.calendar.moreItems", { count: FIXTURE.busyCount - 5 }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("階段、延期、來源待確認以圖示＋文字顯示（不只靠顏色）；活動有圖示＋文字", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month));
    const meta = page.locator(`${cellOf(FIXTURE.multiPlatformDay)} a.card .card-meta`).first();
    await expect(meta.locator("svg[aria-hidden='true']")).toHaveCount(1);
    await expect(meta).toHaveText(msg("zh-Hant", "enums.releaseStage.full"));

    const day22 = page.locator(cellOf("2036-05-22"));
    const delayed = day22.locator("a.card", { hasText: "Delayed Dragon" });
    await expect(delayed.locator(".card-meta")).toContainText(msg("zh-Hant", "enums.releaseStatus.delayed"));
    await expect(delayed.locator(".card-meta svg")).toHaveCount(2);
    const removed = day22.locator("a.card", { hasText: "Removed Rocket" });
    await expect(removed.locator(".card-warn")).toHaveText(msg("zh-Hant", "ui.release.sourceUnconfirmed"));
    await expect(removed.locator(".card-warn svg")).toHaveCount(1);

    const ev = page.locator(`${cellOf(FIXTURE.eventDay)} [data-event]`);
    await expect(ev).toContainText(FIXTURE.event.name);
    await expect(ev.locator(".ev-tag")).toHaveText(msg("zh-Hant", "ui.calendar.event"));
    await expect(ev.locator(".ev-tag svg")).toHaveCount(1);
  });
});

test.describe("篩選", () => {
  test("切換月份保留篩選 query；上／下個月連結都帶篩選", async ({ page }) => {
    const q = `platform=${FIXTURE.platformPs5}`;
    await page.goto(calendarUrl("en", FIXTURE.month, q));
    await expect(page.locator('a[data-month-nav="prev"]')).toHaveAttribute("href", calendarUrl("en", FIXTURE.prevMonth, q));
    await expect(page.locator('a[data-month-nav="next"]')).toHaveAttribute("href", calendarUrl("en", FIXTURE.nextMonth, q));
    await page.locator('a[data-month-nav="next"]').click();
    await expect(page).toHaveURL(new RegExp(`${calendarUrl("en", FIXTURE.nextMonth)}\\?${q}$`));
    await expect(page.locator("a.filter-chip")).toHaveCount(1);
  });

  test("用表單篩選：網址寫入條件、結果筆數在 live region 更新", async ({ page }) => {
    await page.goto(calendarUrl("en", FIXTURE.month));
    await waitForCalendarReady(page);
    const status = page.locator(".cal-tools p[role=status]");
    const before = await status.textContent();
    await page.locator("details.filter-panel > summary").click();
    // fixture 的平台事件數不到「常用平台」門檻，收在「更多平台」裡
    await page.locator("details.more-platforms > summary").click();
    await page.locator(`input[type=checkbox][name=platform][value="${FIXTURE.platformSwitch}"]`).check();
    await page.locator("form.filter-form button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`platform=${FIXTURE.platformSwitch}`));
    await expect(status).not.toHaveText(before ?? "");
    // 只剩 Switch 的兩款：主角（三平台）與月精度遊戲
    await expect(status).toHaveText(msg("en", "filters.resultsCount", { count: 2 }));
  });

  test("未知 slug：200，顯示「已忽略」提示，且從連結中移除", async ({ page }) => {
    const res = await page.goto(calendarUrl("en", FIXTURE.month, `platform=${FIXTURE.platformPs5},nope-console`));
    expect(res?.status()).toBe(200);
    const note = page.locator(".notice[role=note]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("nope-console");
    await expect(page.locator('a[data-month-nav="next"]')).toHaveAttribute("href", calendarUrl("en", FIXTURE.nextMonth, `platform=${FIXTURE.platformPs5}`));
  });

  test("空結果列出條件，可逐一移除", async ({ page }) => {
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, `platform=${FIXTURE.platformSwitch}&genre=${FIXTURE.genreShooter}`));
    const empty = page.locator(".empty-result");
    await expect(empty).toContainText(msg("zh-Hant", "filters.emptyResult"));
    await expect(empty.locator("a.filter-chip")).toHaveCount(2);
  });
});

test.describe("多語系與快取標頭", () => {
  test("`/` 依 Accept-Language 302 到對應語系，且帶 Vary", async ({ playwright }) => {
    const baseURL = test.info().project.use.baseURL!;
    for (const [lang, locale] of [
      ["en-US,en;q=0.9", "en"],
      ["zh-TW,zh;q=0.9", "zh-Hant"],
    ] as const) {
      const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "Accept-Language": lang } });
      const res = await ctx.get("/", { maxRedirects: 0 });
      expect(res.status(), lang).toBe(302);
      expect(res.headers()["location"], lang).toMatch(new RegExp(`^(https?://[^/]+)?/${locale}/calendar/\\d{4}-\\d{2}$`));
      expect(res.headers()["vary"]?.toLowerCase(), lang).toContain("accept-language");
      expect(res.headers()["set-cookie"], lang).toBeUndefined();
      await ctx.dispose();
    }
  });

  test("頁面回應沒有 Set-Cookie（月曆、篩選後月曆、詳情）", async ({ request }) => {
    for (const url of [
      calendarUrl("zh-Hant", FIXTURE.month),
      calendarUrl("en", FIXTURE.month, `platform=${FIXTURE.platformPs5}`),
      gameUrl("zh-Hant", FIXTURE.hero.slug),
      gameUrl("en", FIXTURE.hero.slug),
    ]) {
      const res = await request.get(url, { maxRedirects: 0 });
      expect(res.status(), url).toBe(200);
      expect(res.headers()["set-cookie"], url).toBeUndefined();
    }
  });

  test("語言選單連結指向同一路徑（含 query）的另一語系", async ({ page }) => {
    const q = `platform=${FIXTURE.platformPs5}`;
    await page.goto(calendarUrl("zh-Hant", FIXTURE.month, q));
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
    const menu = page.getByRole("navigation", { name: msg("zh-Hant", "a11y.languageMenu") });
    const en = menu.locator('a[hreflang="en"]');
    await expect(en).toHaveAttribute("href", calendarUrl("en", FIXTURE.month, q));
    await expect(en).toHaveAttribute("lang", "en");
    await expect(menu.locator('a[aria-current="true"]')).toHaveAttribute("hreflang", "zh-Hant");

    await page.goto(gameUrl("en", FIXTURE.hero.slug));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("navigation", { name: msg("en", "a11y.languageMenu") }).locator('a[hreflang="zh-Hant"]')).toHaveAttribute(
      "href",
      gameUrl("zh-Hant", FIXTURE.hero.slug),
    );
  });
});

test.describe("詳情頁", () => {
  test("商店連結、同系列、相似遊戲、DLC、封面 alt", async ({ page }) => {
    await page.goto(gameUrl("zh-Hant", FIXTURE.hero.slug));
    await expect(page.locator("article.detail h1")).toHaveText(FIXTURE.hero.zhName);
    await expect(page.locator("img.detail-cover")).toHaveAttribute("alt", FIXTURE.hero.zhName);
    const ext = page.locator("a.ext-link");
    await expect(ext).toHaveCount(2);
    for (const a of await ext.all()) {
      await expect(a).toHaveAttribute("target", "_blank");
      await expect(a).toHaveAttribute("rel", /noopener/);
    }
    await expect(page.locator("#sec-similar").locator("xpath=..")).toContainText("Similar Quest");
    await expect(page.locator("#sec-dlc").locator("xpath=..")).toContainText("Frost Expansion");
    await expect(page.locator("[id^=sec-franchise-]").first().locator("xpath=..")).toContainText("Aurora Prequel");
    // 英文簡介標 lang
    await expect(page.locator('[lang="en"]', { hasText: "northern lights" })).toHaveCount(1);
  });

  test("不存在的遊戲：顯示找不到（已接受軟 404：200＋noindex）", async ({ page }) => {
    const res = await page.goto(gameUrl("en", "e2e-no-such-game"));
    expect([200, 404]).toContain(res?.status());
    await expect(page.locator("h1")).toHaveText(msg("en", "errors.notFound.title"));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
