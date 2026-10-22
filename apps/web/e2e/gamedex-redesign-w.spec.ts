/**
 * GameDex 改版第 2 段（任務書 W）：
 * - 首頁儀表板 /[locale]：四個區塊（即將上市、最新上市、近期活動、近期熱門）、「查看更多」連結、HTML 與使用者無關、大小預算、
 *   不再導向月曆；舊書籤 /[locale]?<篩選參數> 導向月曆。
 * - 月曆獨立分頁 /[locale]/calendar（導覽列、品牌連結）。
 * - 帳號頁殼＋分頁：切換不整頁重載（殼不重新載入）、直接開子網址選中正確分頁、鍵盤操作、各分頁 axe、320px 不溢出、停權者只剩隱私與資料。
 */
import { api, gameIdBySlug, horizontalOverflow, seedManualSteam, signedInUser, withDb } from "./support/accounts";
import { FIXTURE, FIXTURE_HOME, LOCALES, expect, expectNoA11yViolations, msg, openHeaderMenu, openMainNav, test, type TestLocale } from "./support/helpers";

const HOME_HTML_BUDGET = 200 * 1024;

const dayFromToday = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

test.describe("首頁儀表板", () => {
  test("/en 不導向月曆；四個區塊都在，資料依序（即將：近到遠、最新：新到舊）", async ({ page }) => {
    const res = await page.goto("/en");
    expect(new URL(page.url()).pathname).toBe("/en");
    expect(res!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("GameDex");
    for (const key of ["upcoming", "recent", "events", "trending"] as const) {
      const section = page.locator(`[data-home-section="${key}"]`);
      await expect(section.getByRole("heading", { level: 2, name: msg("en", `ui.home.${key}.title`) })).toBeVisible();
    }
    const slugsIn = (key: string) => page.locator(`[data-home-section="${key}"] [data-home-game]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-home-game")));
    const up = await slugsIn("upcoming");
    expect(up).toEqual(FIXTURE_HOME.upcoming.map((g) => g.slug));
    const rc = await slugsIn("recent");
    expect(rc).toEqual(FIXTURE_HOME.recent.map((g) => g.slug)); // -4 在 -20 之前（新到舊）
    // 活動區（D86）：進行中在前，再依開始時間近到遠；30 天外的活動（含 2036 年的 fixture）不在首頁
    const events = await page.locator('[data-home-section="events"] [data-home-event]').evaluateAll((els) => els.map((e) => e.getAttribute("data-home-event")));
    // 其他測試檔也會在 10 天後插入活動（ical-5），所以只看自己的 fixture：進行中在前、再依開始時間；45 天後的不在窗內
    expect(events.filter((slug) => slug!.startsWith("e2e-home-ev-"))).toEqual([FIXTURE_HOME.events.ongoing.slug, FIXTURE_HOME.events.soon.slug]);
    const trending = await page.locator('[data-trending-panel="upcoming"] [data-home-game]').evaluateAll((els) => els.map((e) => e.getAttribute("data-home-game")));
    expect(trending.length).toBeGreaterThan(0);
    expect(trending.length).toBeLessThanOrEqual(12);
    // 卡片連到遊戲詳情；日期在卡片上
    await expect(page.locator(`[data-home-section="upcoming"] [data-home-game="${FIXTURE_HOME.upcoming[0].slug}"] a`)).toHaveAttribute("href", `/en/games/${FIXTURE_HOME.upcoming[0].slug}`);
    await expect(page.locator(`[data-home-section="upcoming"] [data-home-game="${FIXTURE_HOME.upcoming[0].slug}"] time`)).toHaveAttribute("datetime", dayFromToday(FIXTURE_HOME.upcoming[0].offset));
  });

  test("每區的「查看更多」連到對應頁：月曆、時間軸、活動、熱門榜", async ({ page }) => {
    await page.goto("/en");
    const href = (key: string) => page.locator(`[data-home-more="${key}"]`).getAttribute("href");
    expect(await href("upcoming")).toBe("/en/calendar");
    expect(await href("recent")).toBe(`/en/timeline?at=${dayFromToday(-30)}`);
    expect(await href("events")).toBe("/en/events");
    expect(await href("trending")).toBe("/en/trending");
    // 可及名稱含可見文字，且指出是哪一區
    await expect(page.locator('[data-home-more="events"]')).toHaveAccessibleName(msg("en", "ui.home.moreAria", { section: msg("en", "ui.home.events.title") }));

    await page.locator('[data-home-more="upcoming"]').click();
    await page.waitForURL(/\/en\/calendar\/\d{4}-\d{2}$/);
    await page.goto("/en");
    await page.locator('[data-home-more="recent"]').click();
    await page.waitForURL(/\/en\/timeline\?at=/);
    await page.goto("/en");
    await page.locator('[data-home-more="events"]').click();
    await page.waitForURL(/\/en\/events$/);
    await page.goto("/en");
    await page.locator('[data-home-more="trending"]').click();
    await page.waitForURL(/\/en\/trending$/);
  });

  test("導覽：品牌連結回首頁、「月曆」連到 /calendar（獨立分頁）", async ({ page }) => {
    await page.goto(`/en/calendar/${FIXTURE.month}`);
    await expect(page.locator("[data-site-brand]")).toHaveAttribute("href", "/en");
    let nav = await openMainNav(page, "en");
    await expect(nav.getByRole("link", { name: msg("en", "ui.nav.calendar"), exact: true })).toHaveAttribute("href", "/en/calendar");
    await expect(nav.getByRole("link", { name: msg("en", "ui.nav.calendar"), exact: true })).toHaveAttribute("aria-current", "page");
    await page.locator("[data-site-brand]").click();
    await page.waitForURL("**/en");
    expect(new URL(page.url()).pathname).toBe("/en");
    nav = await openMainNav(page, "en");
    await nav.getByRole("link", { name: msg("en", "ui.nav.calendar"), exact: true }).click();
    await page.waitForURL(/\/en\/calendar\/\d{4}-\d{2}$/);
  });

  test("舊書籤 /en?<月曆篩選參數> 導向月曆（保留參數）；無篩選參數的 /en 與其他 query 不導向", async ({ request }) => {
    const res = await request.get(`/en?platform=${FIXTURE.platformPs5}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(new RegExp(`^/en/calendar/\\d{4}-\\d{2}\\?platform=${FIXTURE.platformPs5}$`));
    const plain = await request.get("/en?utm_source=x", { maxRedirects: 0 });
    expect(plain.status()).toBe(200);
    // 無語系前綴的入口：/ → /{locale}（首頁），/calendar → 月曆
    const root = await request.get("/", { maxRedirects: 0, headers: { "accept-language": "en" } });
    expect(root.status()).toBe(302);
    expect(root.headers().location).toMatch(/\/en$/);
    const cal = await request.get("/calendar", { maxRedirects: 0, headers: { "accept-language": "en" } });
    expect(cal.headers().location).toMatch(/\/en\/calendar\/\d{4}-\d{2}$/);
  });

  test("HTML 與使用者無關（登入者與訪客拿到同一份內容、沒有 Set-Cookie）、可 CDN 快取、大小低於預算", async ({ page, request }) => {
    const email = await signedInUser(page, "home-html", "Home Html Person");
    for (const locale of LOCALES) {
      const anon = await request.get(`/${locale}`);
      const authed = await page.request.get(`/${locale}`);
      for (const res of [anon, authed]) {
        expect(res.status()).toBe(200);
        expect(res.headers()["set-cookie"]).toBeUndefined();
        expect(res.headers()["cache-control"]).toMatch(/s-maxage=60/);
      }
      const html = await authed.text();
      expect(html).not.toContain(email);
      expect(html).not.toContain("Home Html Person");
      const bytes = Buffer.byteLength(await anon.text(), "utf8");
      expect(bytes, `${locale} 首頁 HTML ${bytes} bytes`).toBeLessThan(HOME_HTML_BUDGET);
    }
  });

  test("metadata：title、description、canonical、hreflang、JSON-LD（WebSite＋SearchAction）", async ({ request }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain(`<title>${msg("en", "ui.home.metaTitle")}</title>`);
    expect(html).toContain(`content="${msg("en", "ui.home.metaDescription")}"`);
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/en"\/>/);
    expect(html).toMatch(/hrefLang="x-default"|hreflang="x-default"/i);
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(ld).not.toBeNull();
    const data = JSON.parse(ld![1]!) as { "@type": string; potentialAction: { "@type": string; target: { urlTemplate: string } } };
    expect(data["@type"]).toBe("WebSite");
    expect(data.potentialAction["@type"]).toBe("SearchAction");
    expect(data.potentialAction.target.urlTemplate).toMatch(/\/en\/games\?q=\{search_term_string\}$/);
  });

  test("sitemap 含首頁（各語系）", async ({ request }) => {
    const xml = await (await request.get("/sitemap/pages.xml")).text();
    for (const locale of LOCALES) expect(xml, locale).toMatch(new RegExp(`<loc>[^<]*/${locale}</loc>`));
  });

  test("搜尋框送到 /games?q=", async ({ page }) => {
    await page.goto("/en");
    await page.locator("#home-search").fill("Aurora");
    await page.locator("main").getByRole("button", { name: msg("en", "ui.home.searchButton"), exact: true }).click();
    await page.waitForURL(/\/en\/games\?q=Aurora$/);
  });

  for (const locale of LOCALES) {
    for (const width of [1280, 320]) {
      test(`${locale} 首頁 axe 無違規、寬 ${width} 無水平溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}`);
        await expect(page.locator('[data-home-section="upcoming"] [data-home-game]').first()).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} 首頁 ${width}`);
      });
    }
  }
});

// ── 帳號頁殼與分頁 ────────────────────────────────────────────────────────────

/** 帳號字典（accounts 命名空間）。 */
const m = (locale: TestLocale, key: string, values: Record<string, string | number> = {}) => msg(locale, `accounts.${key}`, values);

const TAB_PATHS = { overview: "", lists: "/lists", plays: "/plays", follows: "/follows", games: "/games", calendar: "/calendar", steam: "/steam", settings: "/settings", privacy: "/privacy" } as const;
type Tab = keyof typeof TAB_PATHS;
const TABS = Object.keys(TAB_PATHS) as Tab[];

const tabLink = (page: import("@playwright/test").Page, locale: TestLocale, tab: Tab) =>
  page.getByRole("navigation", { name: m(locale, "account.tabs.label") }).getByRole("link", { name: m(locale, `account.tab.${tab}`), exact: true });

test.describe("帳號頁殼＋分頁", () => {
  test("分頁列順序、每個分頁有自己的網址；總覽沒有舊的入口連結區", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "tabs-order", "Tabs Person");
    await page.goto(`/${locale}/account`);
    const links = page.getByRole("navigation", { name: m(locale, "account.tabs.label") }).getByRole("link");
    await expect(links).toHaveCount(TABS.length);
    expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(TABS.map((t) => `/${locale}/account${TAB_PATHS[t]}`));
    expect(await links.allTextContents()).toEqual(TABS.map((t) => m(locale, `account.tab.${t}`)));
    await expect(tabLink(page, locale, "overview")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("account-name")).toHaveText("Tabs Person");
    // 舊的入口連結區（我的清單／遊玩紀錄／追蹤…各一個段落）已移除：總覽內容只有已綁定的登入方式
    await expect(page.getByRole("heading", { level: 2, name: m(locale, "account.linked") })).toBeVisible();
    await expect(page.locator("#mine-heading, #track-heading, #settings-heading")).toHaveCount(0);
  });

  test("切換分頁在同一頁內完成（殼與 JS 狀態不重載），網址與 aria-current 跟著變；返回鍵回到上一個分頁", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "tabs-switch");
    await page.goto(`/${locale}/account`);
    await expect(tabLink(page, locale, "overview")).toHaveAttribute("aria-current", "page");
    await page.evaluate(() => {
      (window as unknown as { __shellMarker: string }).__shellMarker = "alive";
      document.querySelector("[data-account-shell]")!.setAttribute("data-marker", "alive");
    });
    for (const tab of TABS.filter((t) => t !== "overview")) {
      await tabLink(page, locale, tab).click();
      await page.waitForURL(`**/${locale}/account${TAB_PATHS[tab]}`);
      await expect(tabLink(page, locale, tab)).toHaveAttribute("aria-current", "page");
      await expect(page.locator(`[data-account-panel="${tab}"]`)).toBeVisible();
      await expect(tabLink(page, locale, "overview")).not.toHaveAttribute("aria-current", "page");
      // 同一份文件、同一個殼
      expect(await page.evaluate(() => (window as unknown as { __shellMarker?: string }).__shellMarker)).toBe("alive");
      await expect(page.locator("[data-account-shell]")).toHaveAttribute("data-marker", "alive");
    }
    await page.goBack();
    await page.waitForURL(`**/${locale}/account${TAB_PATHS.settings}`);
    await expect(tabLink(page, locale, "settings")).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => (window as unknown as { __shellMarker?: string }).__shellMarker)).toBe("alive");
  });

  test("直接開子網址：顯示同一個殼並選中對應分頁（含 /lists/[id] 屬於「我的清單」）", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "tabs-direct");
    const list = await api<{ list: { id: number } }>(page, "POST", "/api/v1/lists", { name: "Direct List" });
    expect(list.status).toBe(201);
    for (const tab of TABS) {
      await page.goto(`/${locale}/account${TAB_PATHS[tab]}`);
      await expect(page.locator("[data-account-shell]")).toBeVisible();
      await expect(tabLink(page, locale, tab)).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[aria-current="page"][data-account-tab]')).toHaveCount(1);
    }
    await page.goto(`/${locale}/account/lists/${list.json.list.id}`);
    await expect(tabLink(page, locale, "lists")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("list-name")).toBeVisible();
    await expect(page.getByTestId("account-name")).toBeVisible();
  });

  test("鍵盤：Tab 依序走過分頁連結，Enter 切換（焦點留在該分頁連結）", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "tabs-kbd");
    await page.goto(`/${locale}/account`);
    await expect(tabLink(page, locale, "overview")).toHaveAttribute("aria-current", "page");
    await tabLink(page, locale, "overview").focus();
    await page.keyboard.press("Tab");
    await expect(tabLink(page, locale, "lists")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(tabLink(page, locale, "plays")).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/${locale}/account/plays`);
    await expect(tabLink(page, locale, "plays")).toHaveAttribute("aria-current", "page");
    await expect(tabLink(page, locale, "plays")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(tabLink(page, locale, "lists")).toBeFocused();
  });

  test("摘要：名稱、信箱、清單數／遊玩紀錄數／追蹤數；換分頁後數字更新", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "tabs-stats", "Stats Person");
    await page.goto(`/${locale}/account`);
    await expect(page.getByTestId("account-email")).toContainText(email);
    const stat = (k: string) => page.locator(`[data-stat="${k}"]`);
    await expect(stat("lists")).toHaveText("0");
    await expect(stat("playRecords")).toHaveText("0");
    await expect(stat("follows")).toHaveText("0");
    const gameId = await gameIdBySlug(FIXTURE.hero.slug);
    expect((await api(page, "POST", "/api/v1/lists", { name: "S1" })).status).toBe(201);
    expect((await api(page, "POST", "/api/v1/lists", { name: "S2" })).status).toBe(201);
    expect((await api(page, "POST", "/api/v1/play-records", { gameId, status: "want_to_play" })).status).toBe(201);
    expect((await api(page, "PUT", `/api/v1/follows/game/${gameId}`)).status).toBe(201);
    await tabLink(page, locale, "lists").click();
    await page.waitForURL(`**/${locale}/account/lists`);
    await expect(stat("lists")).toHaveText("2");
    await expect(stat("playRecords")).toHaveText("1");
    await expect(stat("follows")).toHaveText("1");
    // 頭像：沒有圖片時用名稱的第一個字
    await expect(page.locator('[data-account-avatar="initial"]')).toHaveText("S");
  });

  test("語言選單連結跟著目前分頁（/en/account/lists → /ja/account/lists），切換分頁後仍正確", async ({ page }) => {
    await signedInUser(page, "tabs-lang");
    await page.goto("/en/account");
    await openHeaderMenu(page, "language");
    const ja = page.getByRole("navigation", { name: msg("en", "a11y.languageMenu") }).locator('a[lang="ja"]');
    await expect(ja).toHaveAttribute("href", "/ja/account");
    await tabLink(page, "en", "lists").click();
    await page.waitForURL("**/en/account/lists");
    await openHeaderMenu(page, "language");
    await expect(ja).toHaveAttribute("href", "/ja/account/lists");
  });

  test("Steam 分頁：未綁定顯示說明與綁定按鈕；綁定後顯示遊戲庫", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "tabs-steam");
    await page.goto(`/${locale}/account/steam`);
    await expect(page.getByText(m(locale, "steam.notLinked"))).toBeVisible();
    await expect(page.getByRole("button", { name: m(locale, "account.linkSteam"), exact: true })).toBeVisible();
    await expectNoA11yViolations(page, "steam 分頁（未綁定）");
    await seedManualSteam(email, FIXTURE.hero.slug);
    await page.goto(`/${locale}/account/steam`);
    await expect(page.getByRole("heading", { level: 1, name: m(locale, "steam.title") })).toBeVisible();
    await expect(page.getByRole("button", { name: m(locale, "steam.import"), exact: true }).or(page.getByRole("button", { name: m(locale, "steam.reimport"), exact: true }))).toBeVisible();
    await expectNoA11yViolations(page, "steam 分頁（已綁定）");
  });

  test("未登入：各分頁網址只顯示登入提示（沒有分頁列）、伺服器 HTML 與使用者無關", async ({ page, request }) => {
    const locale: TestLocale = "en";
    for (const tab of TABS) {
      await page.goto(`/${locale}/account${TAB_PATHS[tab]}`);
      await expect(page.getByRole("heading", { name: m(locale, "account.signedOutTitle") })).toBeVisible();
      await expect(page.getByRole("link", { name: m(locale, "account.signIn") })).toHaveAttribute("href", new RegExp(`/${locale}/login\\?next=`));
      await expect(page.getByRole("navigation", { name: m(locale, "account.tabs.label") })).toHaveCount(0);
    }
    const res = await request.get(`/${locale}/account/lists`);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
  });

  test("停權者（D83）：分頁只剩「隱私與資料」，說明只出現一次；其他分頁網址只有說明", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "tabs-suspended");
    await withDb((c) => c.query("UPDATE users SET suspended_at = now() WHERE email = $1", [email.toLowerCase()]));
    await page.goto(`/${locale}/account`);
    await expect(page.locator("[data-account-suspended]")).toHaveCount(1);
    const links = page.getByRole("navigation", { name: m(locale, "account.tabs.label") }).getByRole("link");
    await expect(links).toHaveCount(1);
    await expect(links.first()).toHaveAttribute("href", `/${locale}/account/privacy`);
    await expect(page.locator("[data-account-stats]")).toHaveCount(0);
    await expectNoA11yViolations(page, "停權者 帳號頁殼");
    for (const sub of ["lists", "plays", "follows", "games", "calendar", "steam", "settings"]) {
      await page.goto(`/${locale}/account/${sub}`);
      await expect(page.locator("[data-account-suspended]"), sub).toHaveCount(1);
      await expect(page.locator("main form"), sub).toHaveCount(0);
    }
    await page.goto(`/${locale}/account/privacy`);
    await expect(page.locator("[data-account-suspended]")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: m(locale, "privacy.export.title") })).toBeVisible();
    await expect(page.getByRole("heading", { name: m(locale, "privacy.delete.title") })).toBeVisible();
    await expect(tabLink(page, locale, "privacy")).toHaveAttribute("aria-current", "page");
  });

  test("刪除完成頁仍在殼之外（不需登入、沒有分頁列）", async ({ page }) => {
    await page.goto("/en/account/deleted");
    await expect(page.getByTestId("account-deleted")).toBeVisible();
    await expect(page.locator("[data-account-shell]")).toHaveCount(0);
  });

  for (const locale of LOCALES) {
    for (const width of [1280, 320]) {
      test(`${locale} 全部分頁 axe 無違規、寬 ${width} 無水平溢出${width === 320 ? "（分頁列在自己的容器內橫向捲動）" : ""}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 900 });
        await signedInUser(page, `tabs-axe-${locale}-${width}`, "Axe Person With A Fairly Long Display Name For Wrapping");
        const list = await api<{ list: { id: number } }>(page, "POST", "/api/v1/lists", { name: "Axe list" });
        await api(page, "POST", "/api/v1/play-records", { gameId: await gameIdBySlug(FIXTURE.hero.slug), status: "finished", finishedOn: dayFromToday(-1) });
        const urls = TABS.map((t) => `/${locale}/account${TAB_PATHS[t]}`).concat(`/${locale}/account/lists/${list.json.list.id}`);
        for (const url of urls) {
          await page.goto(url);
          await expect(page.locator('[data-account-stats] [data-stat="lists"]')).toHaveText("1");
          await expect(page.locator("[data-account-panel] h1, [data-account-panel] [id=steam-library-heading], [data-account-panel] [id=steam-link-heading]").first()).toBeVisible();
          expect(await horizontalOverflow(page), `${url} 水平溢出`).toBeLessThanOrEqual(0);
          await expectNoA11yViolations(page, `${url} ${width}`);
        }
        if (width === 320) {
          // 9 個分頁放不進 320px：分頁列自己捲動，目前分頁會捲進可視範圍
          await page.goto(`/${locale}/account/privacy`);
          // 摘要區不能被壓扁成一字一行（名稱欄寬度有下限，放不下就換行）
          expect(await page.locator("[data-account-summary]").evaluate((el) => el.getBoundingClientRect().height), "摘要區高度").toBeLessThan(420);
          const scroller = page.locator("[data-account-tabs] ul");
          expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
          await expect(tabLink(page, locale, "privacy")).toBeInViewport();
        }
      });
    }
  }
});
