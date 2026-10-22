/**
 * 行為（06 §時間軸、§搜尋與瀏覽、§語言支援、§導覽；15 Phase 3b）：導覽列、
 * 瀏覽頁分頁與搜尋、系列／合集切換、活動篩選與詳情、語言支援三態。固定網址進入（fixture 在 2036–2037），不依賴「今天」。
 * 不靠固定 sleep：一律等元素／文字／水合標記。
 */
import type { Locator, Page } from "@playwright/test";
import { FIXTURE, FIXTURE_3B, LOCALES, expect, headerMenu, msg, openMainNav, test } from "./support/helpers";

const MOBILE = { width: 375, height: 812 };

// ── 導覽列 ─────────────────────────────────────────────────────────────

test.describe("導覽列（header 的導覽下拉）", () => {
  for (const locale of LOCALES) {
    test(`八個入口都在、連到對應頁、當前頁 aria-current（${locale}）`, async ({ page }) => {
      await page.goto(`/${locale}/calendar/${FIXTURE.month}`);
      const items: [string, RegExp][] = [
        ["ui.nav.home", new RegExp(`/${locale}$`)],
        ["ui.nav.calendar", /\/calendar/],
        ["ui.nav.timeline", /\/timeline/],
        ["ui.nav.trending", /\/trending/],
        ["ui.nav.games", /\/games$/],
        ["ui.nav.platforms", /\/platforms$/],
        ["ui.nav.events", /\/events$/],
        ["ui.nav.ratings", /\/ratings/],
      ];
      let nav = await openMainNav(page, locale);
      await expect(nav.getByRole("link")).toHaveCount(items.length);
      await expect(nav.getByRole("link", { name: msg(locale, "ui.nav.calendar") })).toHaveAttribute("aria-current", "page");
      for (const [key, url] of items) {
        await nav.getByRole("link", { name: msg(locale, key) }).click();
        await expect(page).toHaveURL(url);
        await expect(page.locator("main h1").first()).toBeVisible();
        nav = await openMainNav(page, locale);
        await expect(nav.getByRole("link", { name: msg(locale, key) })).toHaveAttribute("aria-current", "page");
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      }
    });

    test(`純鍵盤可達：展開導覽、方向鍵移到「遊戲／平台／活動」並用 Enter 開啟（${locale}）`, async ({ page }) => {
      await page.goto(`/${locale}/timeline`);
      for (const [key, url] of [
        ["ui.nav.games", /\/games$/],
        ["ui.nav.platforms", /\/platforms$/],
        ["ui.nav.events", /\/events$/],
      ] as const) {
        const { root, trigger } = headerMenu(page, "nav");
        await expect(root).toHaveAttribute("data-ready", "true");
        await trigger.focus();
        await page.keyboard.press("ArrowDown");
        const link = page.getByRole("navigation", { name: msg(locale, "a11y.mainNavigation") }).getByRole("link", { name: msg(locale, key) });
        for (let i = 0; i < 8 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
        await expect(link).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(url);
        const nav = await openMainNav(page, locale);
        await expect(nav.getByRole("link", { name: msg(locale, key) })).toHaveAttribute("aria-current", "page");
      }
    });
  }

  test("實體詳情頁（平台頁、活動詳情）的對應導覽項有 aria-current；遊戲詳情頁的「遊戲」沒有", async ({ page }) => {
    await page.goto("/en/platforms/e2e-ps5");
    await expect((await openMainNav(page, "en")).getByRole("link", { name: msg("en", "ui.nav.platforms") })).toHaveAttribute("aria-current", "page");
    await page.goto(`/en/events/${FIXTURE_3B.events.showcase.slug}`);
    await expect((await openMainNav(page, "en")).getByRole("link", { name: msg("en", "ui.nav.events") })).toHaveAttribute("aria-current", "page");
    await page.goto(`/en/games/${FIXTURE.hero.slug}`);
    await expect((await openMainNav(page, "en")).getByRole("link", { name: msg("en", "ui.nav.games") })).not.toHaveAttribute("aria-current", "page");
  });

  test("手機 375 寬：八個入口都完整在視窗內、觸控目標 >= 44px、頁面不水平捲動", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/en/games");
    const links = (await openMainNav(page, "en")).getByRole("link");
    await expect(links).toHaveCount(8);
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box, "導覽連結要有版面").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

// ── 瀏覽與搜尋 ──────────────────────────────────────────────────────────

test.describe("瀏覽 /games", () => {
  const cards = (page: Page): Locator => page.locator("ul[aria-label] > li", { has: page.locator("a[href*='/games/']") });
  const slugs = (page: Page) => cards(page).locator("a[href*='/games/']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));

  test("分頁：下一頁 → 上一頁；兩頁不重疊；頁碼 aria-current；第 1 頁網址不帶 page", async ({ page }) => {
    await page.goto("/en/games");
    await expect(cards(page)).toHaveCount(FIXTURE_3B.browsePageSize);
    const first = await slugs(page);
    const pager = page.getByRole("navigation", { name: msg("en", "ui.games.pagination") });
    await expect(pager.getByRole("link", { name: msg("en", "ui.games.prevPage") })).toHaveCount(0);
    await expect(pager.locator('[aria-current="page"]')).toHaveText(msg("en", "ui.games.page", { page: 1 }));

    await pager.getByRole("link", { name: msg("en", "ui.games.nextPage") }).click();
    await expect(page).toHaveURL(/[?&]page=2$/);
    await expect(pager.locator('[aria-current="page"]')).toHaveText(msg("en", "ui.games.page", { page: 2 }));
    await expect(cards(page).first()).toBeVisible();
    const second = await slugs(page);
    expect(second.length).toBeGreaterThan(0);
    expect(second.filter((s) => first.includes(s)), "第 2 頁不可含第 1 頁的遊戲").toEqual([]);

    await pager.getByRole("link", { name: msg("en", "ui.games.prevPage") }).click();
    await expect(page).toHaveURL(/\/en\/games$/);
    expect(await slugs(page)).toEqual(first);
  });

  test("分頁：純鍵盤（焦點在下一頁連結按 Enter）", async ({ page }) => {
    await page.goto("/zh-Hant/games");
    const next = page.getByRole("link", { name: msg("zh-Hant", "ui.games.nextPage") });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/page=2/);
  });

  test("搜尋：輸入後按 Enter 送出 → 網址帶 q、只剩符合的遊戲、有可移除的條件 chip", async ({ page }) => {
    await page.goto("/en/games");
    const box = page.locator('#browse-search');
    await box.fill(FIXTURE_3B.searchTerm);
    await box.press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${FIXTURE_3B.searchTerm}`));
    const list = cards(page);
    await expect(list.first()).toBeVisible();
    expect(await list.count()).toBeGreaterThanOrEqual(2);
    for (const text of await list.allTextContents()) expect(text).toMatch(/Aurora/i);
    await expect(page.locator(`a[href$="/en/games/${FIXTURE.hero.slug}"]`)).toHaveCount(1);
    await expect(page.locator("a.filter-chip")).toHaveCount(1);
    await expect(box).toHaveValue(FIXTURE_3B.searchTerm);
    await page.locator("a.filter-chip").click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page.locator("a.filter-chip")).toHaveCount(0);
  });

  test("搜尋：沒有結果 → 空結果提示（200，不是錯誤頁）", async ({ page }) => {
    const res = await page.goto("/en/games?q=zzzznomatchzzzz");
    expect(res?.status()).toBe(200);
    await expect(page.locator(".empty-result")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });

  test("搜尋：中文顯示名稱也找得到", async ({ page }) => {
    await page.goto(`/zh-Hant/games?q=${encodeURIComponent("極光")}`);
    await expect(page.locator(`a[href$="/zh-Hant/games/${FIXTURE.hero.slug}"]`)).toHaveCount(1);
  });
});

// ── 系列與合集、實體頁連結 ──────────────────────────────────────────────

test.describe("系列頁：franchise 與 collection 同 slug", () => {
  const twin = FIXTURE_3B.twin;

  test("預設是系列；有切換連結；切換後是合集、再切回", async ({ page }) => {
    await page.goto(`/en/franchises/${twin.slug}`);
    await expect(page.locator("h1")).toContainText(twin.name);
    await expect(page.locator("[data-game]")).toHaveCount(2);
    await expect(page.locator('[data-game="e2e-twin-franchise-only"]')).toHaveCount(1);
    await expect(page.locator('[data-game="e2e-twin-collection-only"]')).toHaveCount(0);
    const toCollection = page.getByRole("link", { name: msg("en", "ui.franchises.switchTo", { kind: msg("en", "ui.franchises.kind.collection") }) });
    await expect(toCollection).toHaveAttribute("href", `/en/franchises/${twin.slug}?kind=collection`);

    await toCollection.click();
    await expect(page).toHaveURL(/kind=collection/);
    await expect(page.locator("[data-game]")).toHaveCount(2);
    await expect(page.locator('[data-game="e2e-twin-collection-only"]')).toHaveCount(1);
    await expect(page.locator('[data-game="e2e-twin-franchise-only"]')).toHaveCount(0);
    await expect(page.locator('[data-game="e2e-twin-both"]')).toHaveCount(1);

    await page.getByRole("link", { name: msg("en", "ui.franchises.switchTo", { kind: msg("en", "ui.franchises.kind.franchise") }) }).click();
    await expect(page).toHaveURL(new RegExp(`/en/franchises/${twin.slug}$`));
    await expect(page.locator('[data-game="e2e-twin-franchise-only"]')).toHaveCount(1);
  });

  test("只有一種 kind 的系列沒有切換連結；要求不存在的 kind 是軟 404", async ({ page }) => {
    await page.goto("/en/franchises/e2e-aurora-saga");
    await expect(page.locator("h1")).toContainText("Aurora Saga");
    await expect(page.getByRole("navigation", { name: msg("en", "ui.franchises.otherKindsLabel") })).toHaveCount(0);
    await page.goto("/en/franchises/e2e-aurora-saga?kind=collection");
    await expect(page.locator("h1")).toHaveText(msg("en", "errors.notFound.title"));
  });

  test("詳情頁：同時屬於系列與合集時，兩段分別連到 franchise 與 ?kind=collection", async ({ page }) => {
    await page.goto("/en/games/e2e-twin-both");
    await expect(page.locator(`a[href="/en/franchises/${twin.slug}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="/en/franchises/${twin.slug}?kind=collection"]`)).toHaveCount(1);
  });
});

test.describe("實體頁互相連結", () => {
  test("詳情 → 公司頁；平台總覽 → 平台頁", async ({ page }) => {
    await page.goto(`/en/games/${FIXTURE.hero.slug}`);
    await page.locator('a[href="/en/companies/e2e-northern-studio"]').first().click();
    await expect(page).toHaveURL(/\/companies\/e2e-northern-studio$/);
    await expect(page.locator("h1")).toContainText("E2E Northern Studio");
    await expect(page.locator(`[data-game="${FIXTURE.hero.slug}"]`)).toHaveCount(1);
    await page.goto("/en/platforms");
    await page.locator('a[href="/en/platforms/e2e-ps5"]').first().click();
    await expect(page).toHaveURL(/\/platforms\/e2e-ps5$/);
    await expect(page.locator("h1")).toContainText("PlayStation 5");
  });
});

// ── 活動 ───────────────────────────────────────────────────────────────

test.describe("活動", () => {
  const E = FIXTURE_3B.events;
  const list = (page: Page) => page.locator("[data-events] > li");
  const kindNav = (page: Page) => page.getByRole("navigation", { name: msg("en", "ui.events.kindLabel") });
  const scopeNav = (page: Page) => page.getByRole("navigation", { name: msg("en", "ui.events.scopeLabel") });

  test("預設列出未來的活動，不含已結束與時間未定；類型與時間範圍可切換", async ({ page }) => {
    await page.goto("/en/events");
    // 2036 年的兩場＋首頁近期活動的三場 fixture（FIXTURE_HOME.events，kind other；時間相對 seed 當下，所以也在 upcoming）
    await expect(list(page).filter({ hasText: /Home Event/ })).toHaveCount(3);
    await expect(page.getByText(E.showcase.name)).toBeVisible();
    await expect(page.getByText(E.expo.name)).toBeVisible();
    await expect(page.getByText(E.past.name)).toHaveCount(0);
    await expect(page.getByText(E.undated.name)).toHaveCount(0);

    await kindNav(page).getByRole("link", { name: msg("en", "enums.eventKind.expo") }).click();
    await expect(page).toHaveURL(/kind=expo/);
    await expect(list(page)).toHaveCount(1);
    await expect(page.getByText(E.expo.name)).toBeVisible();

    await scopeNav(page).getByRole("link", { name: msg("en", "ui.events.scope.past") }).click();
    await expect(page).toHaveURL(/kind=expo/);
    await expect(page).toHaveURL(/when=past/);
    await expect(page.getByText(msg("en", "ui.events.empty"))).toBeVisible();

    await kindNav(page).getByRole("link", { name: msg("en", "enums.eventKind.awards") }).click();
    await expect(list(page)).toHaveCount(1);
    await expect(page.getByText(E.past.name)).toBeVisible();

    await page.goto("/en/events?when=undated");
    await expect(list(page)).toHaveCount(1);
    await expect(page.getByText(E.undated.name)).toBeVisible();
    await expect(page.getByText(msg("en", "ui.events.timeTbd")).first()).toBeVisible();
  });

  test("目前選到的時間範圍與類型有 aria-current", async ({ page }) => {
    await page.goto("/en/events?kind=awards&when=past");
    await expect(scopeNav(page).locator('[aria-current="page"]')).toHaveText(msg("en", "ui.events.scope.past"));
    await expect(kindNav(page).locator('[aria-current="page"]')).toHaveText(msg("en", "enums.eventKind.awards"));
  });

  test("詳情：時間未定顯示日期尚未公布與說明", async ({ page }) => {
    await page.goto(`/en/events/${E.undated.slug}`);
    await expect(page.locator("h1")).toHaveText(E.undated.name);
    const info = page.locator("[data-event-info]");
    await expect(info).toContainText(msg("en", "ui.events.timeTbd"));
    await expect(info).toContainText(msg("en", "ui.events.undatedHint"));
    await expect(page.getByText(msg("en", "ui.events.noGames"))).toBeVisible();
  });

  test("詳情：外部連結屬性安全，相關遊戲連回詳情", async ({ page }) => {
    await page.goto(`/en/events/${E.expo.slug}`);
    const site = page.getByRole("link", { name: new RegExp(msg("en", "ui.events.officialSite")) });
    await expect(site).toHaveAttribute("href", /^https:\/\/expo\.example\.test\/?$/);
    await expect(site).toHaveAttribute("target", "_blank");
    await expect(site).toHaveAttribute("rel", /noopener/);
    await page.locator(`[data-game="${FIXTURE_3B.langPartial.slug}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/games/${FIXTURE_3B.langPartial.slug}$`));
  });

  test("遊戲詳情的即將亮相活動連到活動詳情，活動詳情的相關遊戲含該遊戲", async ({ page }) => {
    await page.goto(`/en/games/${FIXTURE.hero.slug}`);
    await page.locator(`section[aria-labelledby="sec-events"] a[href="/en/events/${E.showcase.slug}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${E.showcase.slug}$`));
    await expect(page.locator("h1")).toHaveText(E.showcase.name);
    await expect(page.locator(`[data-game="${FIXTURE.hero.slug}"]`)).toHaveCount(1);
  });
});

// ── 語言支援三態 ────────────────────────────────────────────────────────

test.describe("語言支援", () => {
  const section = (page: Page) => page.locator('section[aria-labelledby="sec-languages"]');
  const forbidden = /不支援|Not supported|Unsupported/i;

  for (const locale of LOCALES) {
    test(`有資料（${locale}）：表格、網站語言置頂、沒有不支援字樣`, async ({ page }) => {
      await page.goto(`/${locale}/games/${FIXTURE.hero.slug}`);
      const table = section(page).locator("table[data-language-table]");
      await expect(table).toBeVisible();
      await expect(table.locator("tbody tr")).toHaveCount(3);
      await expect(table.locator("thead th")).toHaveCount(4);
      await expect(table.locator("tbody tr").first().locator("th")).toContainText({ en: "English", ja: "日本語", "zh-Hant": "繁體中文" }[locale]);
      await expect(table.locator("td", { hasText: msg(locale, "ui.langSupport.columnNoData") })).toHaveCount(0);
      expect(await section(page).innerText()).not.toMatch(forbidden);
      await expect(table.locator("td .sr-only", { hasText: msg(locale, "ui.langSupport.cellNoData") }).first()).toBeAttached();
    });

    test(`某欄未提供資料（${locale}）：字幕、語音兩欄各一格未提供資料跨全部列`, async ({ page }) => {
      await page.goto(`/${locale}/games/${FIXTURE_3B.langPartial.slug}`);
      const table = section(page).locator("table[data-language-table]");
      await expect(table.locator("tbody tr")).toHaveCount(2);
      const noData = table.locator("td", { hasText: msg(locale, "ui.langSupport.columnNoData") });
      await expect(noData).toHaveCount(2);
      for (const td of await noData.all()) await expect(td).toHaveAttribute("rowspan", "2");
      expect(await section(page).innerText()).not.toMatch(forbidden);
    });

    test(`整區尚無資料（${locale}）：寫尚無語言資料與說明，沒有表格`, async ({ page }) => {
      await page.goto(`/${locale}/games/${FIXTURE_3B.langNone.slug}`);
      await expect(section(page).getByText(msg(locale, "ui.langSupport.sectionNoData"))).toBeVisible();
      await expect(section(page).getByText(msg(locale, "ui.langSupport.sectionNoDataNote"))).toBeVisible();
      await expect(section(page).locator("table")).toHaveCount(0);
      expect(await section(page).innerText()).not.toMatch(forbidden);
    });
  }
});

test("熱門榜：fixture 沒有熱度資料時仍正常顯示（200）", async ({ page }) => {
  const res = await page.goto("/en/trending");
  expect(res?.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveText(msg("en", "ui.trending.title"));
});
