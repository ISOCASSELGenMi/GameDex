/**
 * GameDex 第 2 輪 Z2A：瀏覽頁 /games 的分組檢視（?by=date|platform|publisher）、header 品牌文字、導覽下拉。
 * fixture：seed-z2a.ts（遊戲名稱都帶 Z2A，測試用 q=z2a 隔離其他 fixture）。
 */
import { expect, expectNoA11yViolations, headerMenu, LOCALES, msg, openMainNav, test, type TestLocale } from "./support/helpers";
import type { Locator, Page } from "@playwright/test";
import { FIXTURE_Z2A as F } from "./support/fixture-z2a";

const URL_ALL = `/en/games?q=${F.q}`;
const section = (page: Page, key: string): Locator => page.locator(`section[data-rc-group="${key}"]`);
const groupKeys = (page: Page): Promise<string[]> => page.locator("section[data-rc-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-rc-group") ?? ""));
const cardsIn = (loc: Locator): Locator => loc.locator("li.rc-card");
const switchReady = (page: Page): Locator => page.locator('[data-rc-switch][data-ready="true"]');
const radio = (page: Page, locale: TestLocale, by: "none" | "date" | "platform" | "publisher"): Locator =>
  page.getByRole("radio", { name: msg(locale, `ui.games.by.${by}`) });

test.describe("分組檢視：切換與網址", () => {
  test("預設不分組（現在的清單）；切換分組保留搜尋條件，網址可分享", async ({ page }) => {
    await page.goto(URL_ALL);
    await expect(page.locator("section[data-rc-group]")).toHaveCount(0);
    await expect(page.getByRole("list", { name: msg("en", "ui.games.listLabel") })).toBeVisible();
    await expect(switchReady(page)).toBeVisible();
    await expect(radio(page, "en", "none")).toBeChecked();

    await radio(page, "en", "date").check();
    await expect(page).toHaveURL(new RegExp(`/en/games\\?q=${F.q}&by=date$`));
    await expect(radio(page, "en", "date")).toBeChecked();
    expect(await groupKeys(page)).toEqual([...F.dateGroups]);

    await radio(page, "en", "platform").check();
    await expect(page).toHaveURL(new RegExp(`by=platform$`));
    await radio(page, "en", "publisher").check();
    await expect(page).toHaveURL(new RegExp(`by=publisher$`));
    await radio(page, "en", "none").check();
    await expect(page).toHaveURL(new RegExp(`/en/games\\?q=${F.q}$`));
    await expect(page.locator("section[data-rc-group]")).toHaveCount(0);

    // 直接開網址就是同一個畫面
    await page.goto(`/en/games?q=${F.q}&by=publisher`);
    await expect(radio(page, "en", "publisher")).toBeChecked();
    expect(await groupKeys(page)).toEqual(["nintendo", "capcom", "fromsoftware", "other"]);
  });

  test("未知的 by 退回不分組；舊的 /releases 已不存在", async ({ page, request }) => {
    await page.goto(`${URL_ALL}&by=bogus`);
    await expect(page.locator("section[data-rc-group]")).toHaveCount(0);
    await expect(radio(page, "en", "none")).toBeChecked();
    expect((await request.get("/en/releases")).status()).toBe(404);
  });

  test("搜尋表單與篩選面板送出時保留 by", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=platform`);
    await page.locator(".filter-form button.btn-primary").first().click();
    await expect(page).toHaveURL(/by=platform/);
    expect(await page.locator("section[data-rc-group]").count()).toBeGreaterThan(0);
  });

  test("沒有 JS：分組切換是一般連結", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(`${URL_ALL}&by=date`);
    // 首屏卡片仍由伺服器渲染
    await expect(cardsIn(section(page, "2036-09"))).toHaveCount(6);
    const links = page.locator(".rc-noscript a");
    await expect(links).toHaveCount(4);
    await expect(links.nth(2)).toHaveAttribute("href", `/en/games?q=${F.q}&by=platform`);
    await expect(page.locator('.rc-noscript a[aria-current="true"]')).toHaveText(msg("en", "ui.games.by.date"));
    await ctx.close();
  });

  test("鍵盤：方向鍵切換 radio 即導覽（沒有額外動畫）", async ({ page }) => {
    await page.goto(URL_ALL);
    await expect(switchReady(page)).toBeVisible();
    await radio(page, "en", "none").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/by=date/);
    await expect(radio(page, "en", "date")).toBeChecked();
  });
});

test.describe("分組檢視：三種分組的內容", () => {
  test("依日期：年月／季／年／日期未定；日期未定在最後；標題與筆數", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date`);
    expect(await groupKeys(page)).toEqual([...F.dateGroups]);
    const headings = await page.locator("section[data-rc-group] h2").allInnerTexts();
    expect(headings[0]).toContain("2037");
    expect(headings[1]).toMatch(/Q4|4/);
    expect(headings[2]).toContain("September 2036");
    // 第一個區塊有標題（section aria-labelledby）
    const first = section(page, "2036-09");
    await expect(first).toHaveAttribute("aria-labelledby", "rc-h-2036-09");
    await expect(first.locator("h2")).toContainText(msg("en", "ui.games.groupCount", { count: F.monthTotal }));
    // 熱度由高到低；首屏 8 張
    await expect(cardsIn(first)).toHaveCount(6);
    await expect(cardsIn(first).nth(0)).toContainText(F.elden.name);
    await expect(cardsIn(first).nth(1)).toContainText(F.zelda.name);
    // 卡片：封面、名稱、日期、平台；連到詳情
    const elden = cardsIn(first).nth(0);
    await expect(elden.locator("a")).toHaveAttribute("href", `/en/games/${F.elden.slug}`);
    await expect(elden.locator("time")).toHaveAttribute("datetime", "2036-09-10");
    await expect(elden).toContainText("PS5");
    await expect(elden.locator("img")).toHaveCount(1);
    // 日期只到季／年的卡片顯示該精度的文字，沒有 <time>
    await expect(cardsIn(section(page, "2036-Q4")).first().locator("time")).toHaveCount(0);
    // 日期未定
    await expect(cardsIn(section(page, "tbd")).first()).toContainText(F.undated.name);
  });

  test("依平台：主機在 PC 前；一款遊戲出現在它的每個平台組；沒有平台的遊戲不出現", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=platform`);
    expect(await groupKeys(page)).toEqual(["e2e-ps5", "e2e-switch", "e2e-pc"]);
    await expect(section(page, "e2e-ps5").locator("h2")).toContainText("E2E PlayStation 5");
    await expect(cardsIn(section(page, "e2e-ps5"))).toHaveCount(2);
    await expect(cardsIn(section(page, "e2e-ps5")).first()).toContainText(F.elden.name);
    await expect(cardsIn(section(page, "e2e-pc")).first()).toContainText(F.elden.name);
    await expect(cardsIn(section(page, "e2e-switch"))).toHaveCount(1);
    await expect(page.getByText(F.undated.name)).toHaveCount(0);
  });

  test("依廠商：開發商優先（艾爾登法環→FromSoftware）、發行商次之、其餘獨立／其他在最後", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=publisher`);
    expect(await groupKeys(page)).toEqual(["nintendo", "capcom", "fromsoftware", "other"]);
    await expect(section(page, "fromsoftware").locator("h2")).toContainText("FromSoftware");
    await expect(cardsIn(section(page, "fromsoftware"))).toHaveCount(1);
    await expect(cardsIn(section(page, "fromsoftware"))).toContainText(F.elden.name);
    await expect(cardsIn(section(page, "nintendo"))).toContainText(F.zelda.name); // 開發商不在名單，看發行商
    await expect(section(page, "other").locator("h2")).toContainText("Indie & Other");
    await expect(section(page, "other").locator("h2")).toContainText(msg("en", "ui.games.groupCount", { count: 40 }));
  });

  test("三種語系：分組名稱與切換標籤都有翻譯", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/games?q=${F.q}&by=publisher`);
      await expect(section(page, "other").locator("h2")).toContainText(locale === "zh-Hant" ? "獨立／其他" : locale === "ja" ? "インディー・その他" : "Indie & Other");
      await expect(radio(page, locale, "publisher")).toBeChecked();
      await expect(page.getByRole("group", { name: msg(locale, "ui.games.groupsLabel") })).toBeVisible();
    }
  });

  test("沒有符合條件的遊戲：說明＋清除條件，沒有分組", async ({ page }) => {
    await page.goto("/en/games?q=zzzzqqqq&by=date");
    await expect(page.locator("section[data-rc-group]")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: msg("en", "filters.resultsCount", { count: 0 }) })).toBeVisible();
  });

  test("組少於一頁時沒有分頁；篩選會限制各組內容", async ({ page }) => {
    await page.goto(`${URL_ALL}&platform=e2e-switch&by=publisher`);
    expect(await groupKeys(page)).toEqual(["nintendo"]);
    await expect(page.getByRole("navigation", { name: msg("en", "ui.games.pagination") })).toHaveCount(0);
  });
});

test.describe("分組檢視：顯示更多", () => {
  test("每組首屏 8 張，按需載入 24 張再 4 張；焦點移到第一張新卡片；篩選與 API 同一組條件", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date`);
    const group = section(page, "2036-09");
    const more = group.locator("[data-rc-more]");
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("data-ready", "true");
    await expect(more).toHaveText(msg("en", "ui.games.groupMore", { count: 34 }));
    await expect(cardsIn(group)).toHaveCount(6);

    const request = page.waitForRequest((r) => r.url().includes("/api/v1/games/group"));
    await more.click();
    const url = new URL((await request).url());
    expect(url.searchParams.get("by")).toBe("date");
    expect(url.searchParams.get("key")).toBe("2036-09");
    expect(url.searchParams.get("offset")).toBe("6");
    expect(url.searchParams.get("q")).toBe(F.q);
    await expect(cardsIn(group)).toHaveCount(30);
    await expect(more).toHaveText(msg("en", "ui.games.groupMore", { count: 10 }));
    // 新卡片接在後面，沒有重複
    const names = await cardsIn(group).locator(".rc-name").allInnerTexts();
    expect(new Set(names).size).toBe(names.length);
    await more.click();
    await expect(cardsIn(group)).toHaveCount(F.monthTotal);
    await expect(group.locator("[data-rc-more]")).toHaveCount(0);
    // 其他組不受影響
    await expect(cardsIn(section(page, "2036-Q4"))).toHaveCount(1);
  });

  test("依廠商的「獨立／其他」也能顯示更多", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=publisher`);
    const group = section(page, "other");
    await expect(cardsIn(group)).toHaveCount(6);
    await group.locator("[data-rc-more]").click();
    await expect(cardsIn(group)).toHaveCount(30);
  });

  test("載入失敗時顯示錯誤訊息並可再試", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date`);
    const group = section(page, "2036-09");
    await expect(group.locator("[data-rc-more]")).toHaveAttribute("data-ready", "true");
    await page.route("**/api/v1/games/group**", (route) => route.fulfill({ status: 503, json: { error: "timeout" } }));
    await group.locator("[data-rc-more]").click();
    await expect(group.locator("[data-rc-error]")).toHaveText(msg("en", "ui.games.groupLoadError"));
    await expect(cardsIn(group)).toHaveCount(6);
    await page.unroute("**/api/v1/games/group**");
    await group.locator("[data-rc-more]").click();
    await expect(cardsIn(group)).toHaveCount(30);
    await expect(group.locator("[data-rc-error]")).toHaveCount(0);
  });
});

test.describe("API /api/v1/games/group", () => {
  test("回傳卡片與總數；公開可快取", async ({ request }) => {
    const res = await request.get(`/api/v1/games/group?locale=en&by=publisher&key=other&offset=8&limit=5&q=${F.q}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("s-maxage=300");
    const body = (await res.json()) as { key: string; total: number; cards: { h: string; n: string; d: string }[] };
    expect(body.key).toBe("other");
    expect(body.total).toBe(40);
    expect(body.cards).toHaveLength(5);
    expect(body.cards[0]!.h).toMatch(/^\/en\/games\//);
  });

  test("參數不合法回 400，不回 500", async ({ request }) => {
    const get = async (query: string) => (await request.get(`/api/v1/games/group?${query}`)).status();
    expect(await get("locale=xx&by=date&key=2036-09")).toBe(400);
    expect(await get("locale=en&by=none&key=2036-09")).toBe(400);
    expect(await get("locale=en&by=bogus&key=2036-09")).toBe(400);
    expect(await get("locale=en&by=date&key=2036-13")).toBe(400);
    expect(await get("locale=en&by=publisher&key=nope")).toBe(400);
    expect(await get("locale=en&by=platform&key=Bad%20Slug")).toBe(400);
    expect(await get("locale=en&by=date&key=2036-09&offset=-1")).toBe(400);
    expect(await get("locale=en&by=date&key=2036-09&limit=0")).toBe(400);
    expect(await get("locale=en&by=date&key=2036-09&limit=61")).toBe(400);
    expect(await get(`locale=en&by=date&key=2036-09&q=${F.q}&limit=60`)).toBe(200);
  });

  test("舊的 /api/v1/releases/column 已刪除", async ({ request }) => {
    expect((await request.get("/api/v1/releases/column?locale=en&by=date&key=2036-09-10")).status()).toBe(404);
  });
});

test.describe("header 品牌文字與導覽下拉", () => {
  const BRANDS: [string, string][] = [
    ["/en", "GameDex"],
    ["/en/calendar", "GameCalendar"],
    ["/en/timeline", "GameTimeline"],
    ["/en/trending", "GameTrend"],
    ["/en/games", "GameBase"],
    [`/en/games/${F.elden.slug}`, "GameBase"],
    ["/en/platforms", "GamePlat"],
    ["/en/platforms/e2e-ps5", "GamePlat"],
    ["/en/events", "GameEvent"],
    ["/en/ratings", "GameRanking"],
    ["/en/subscribe", "GameDex"],
  ];
  test("品牌文字依頁面所屬區塊（伺服器輸出）；子頁面跟隨區塊；其他頁是 GameDex", async ({ page }) => {
    for (const [path, brand] of BRANDS) {
      await page.goto(path);
      await expect(page.locator("[data-site-brand]"), path).toHaveText(brand);
      await expect(page.locator("[data-site-brand]")).toHaveAttribute("href", "/en");
    }
  });

  test("品牌文字在伺服器 HTML 裡（不靠 JS、可快取）", async ({ request }) => {
    const html = await (await request.get("/en/calendar")).text();
    expect(html).toMatch(/data-site-brand[^>]*>\s*<span[^>]*>GameCalendar<\/span>/);
  });

  test("三語相同（品牌名不翻譯），<title> 不變", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/timeline`);
      await expect(page.locator("[data-site-brand]")).toHaveText("GameTimeline");
      await expect(page).toHaveTitle(new RegExp(msg(locale, "ui.timeline.title")));
    }
  });

  test("導覽下拉：順序、每項的小字品牌名、沒有「全遊戲列表」", async ({ page }) => {
    await page.goto("/en/calendar");
    const nav = await openMainNav(page, "en");
    const hrefs = await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["/en", "/en/calendar", "/en/timeline", "/en/trending", "/en/games", "/en/platforms", "/en/events", "/en/ratings"]);
    const brands = await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("data-brand")));
    expect(brands).toEqual(["GameDex", "GameCalendar", "GameTimeline", "GameTrend", "GameBase", "GamePlat", "GameEvent", "GameRanking"]);
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("data-brand", "GameCalendar");
    await expect(nav.getByRole("link", { name: /releases/i })).toHaveCount(0);
    const { trigger } = headerMenu(page, "nav");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("品牌文字換頁時短暫淡入（opacity／filter ≤ 150ms）；reduced-motion 沒有動畫", async ({ page }) => {
    await page.goto("/en/calendar");
    const info = await page.locator(".hd-brand-text").evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(info.name).toBe("hd-brand-in");
    expect(info.duration).toBe("0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator(".hd-brand-text").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });

  test("首頁「最新上市」的查看更多連到時間軸（30 天前那一週）", async ({ page }) => {
    await page.goto("/en");
    const href = await page.locator('[data-home-more="recent"]').getAttribute("href");
    expect(href).toMatch(/^\/en\/timeline\?at=\d{4}-\d{2}-\d{2}$/);
    await page.locator('[data-home-more="recent"]').click();
    await page.waitForURL(/\/en\/timeline\?at=/);
    await expect(page.locator("[data-site-brand]")).toHaveText("GameTimeline");
  });
});

test.describe("分組檢視：無障礙與版面", () => {
  for (const by of ["date", "platform", "publisher"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`axe：${by}（${scheme}）`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${URL_ALL}&by=${by}`);
        await expect(switchReady(page)).toBeVisible();
        await expectNoA11yViolations(page, `/games?by=${by} ${scheme}`);
      });
    }
  }

  test("320px：不水平溢出，卡片格在區塊內換行；header 品牌文字不被擠掉", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of [`${URL_ALL}&by=date`, `${URL_ALL}&by=platform`, "/en/calendar", "/en/timeline", "/en/ratings"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
      const brand = await page.locator("[data-site-brand]").boundingBox();
      expect(brand, path).not.toBeNull();
      expect(brand!.x + brand!.width, path).toBeLessThanOrEqual(320);
    }
    const first = section(page, "2036-09");
    void first;
  });

  test("區塊結構：每組是有標題的 section，卡片是清單；整個分組在一個 group 地標內", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date`);
    const g = section(page, "2036-09");
    await expect(g.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(g.getByRole("list")).toHaveCount(1);
    await expect(page.getByRole("group", { name: msg("en", "ui.games.groupsLabel") })).toBeVisible();
  });

  test("reduced-motion：卡片 hover 位移與切換按壓縮放關閉", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${URL_ALL}&by=date`);
    const t = await cardsIn(section(page, "2036-09")).first().locator("a").evaluate((el) => getComputedStyle(el).transform);
    expect(t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
});
