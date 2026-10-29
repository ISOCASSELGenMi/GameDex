/**
 * 2026-10-29：/games 的卡片等高（第二行固定顯示原文）、依日期分組的起算月（gfrom／跳到年月）、依平台／廠商的組排序（gsort／gdir）、
 * 平台總覽依平台發售日排序（sort=release&dir=）。
 * fixture：seed-z2a.ts（遊戲名稱都帶 Z2A，q=z2a 隔離）與 seed.ts（hero Aurora Odyssey 有 zh-Hant 譯名；平台發售日）。
 */
import type { Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, msg, test } from "./support/helpers";
import { FIXTURE, FIXTURE_3B } from "./support/fixture-data";
import { FIXTURE_Z2A as F } from "./support/fixture-z2a";

const URL_ALL = `/en/games?q=${F.q}`;
const section = (page: Page, key: string): Locator => page.locator(`section[data-rc-group="${key}"]`);
const groupKeys = (page: Page): Promise<string[]> => page.locator("section[data-rc-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-rc-group") ?? ""));
const expectKeys = (page: Page, keys: string[]): Promise<void> => expect.poll(() => groupKeys(page)).toEqual(keys);
const switchReady = (page: Page): Locator => page.locator('[data-rc-switch][data-ready="true"]');

test.describe("卡片等高：第二行固定顯示標題原文", () => {
  test("不分組的清單：每張卡都有第二行（有譯名顯示原文、沒有就留空但保留一行高度），同一列的卡片等高、卡片撐滿格子", async ({ page }) => {
    await page.goto(`/zh-Hant/games?q=${FIXTURE_3B.searchTerm}`);
    const items = page.locator("li[data-browse-item]");
    expect(await items.count()).toBeGreaterThan(1);
    const info = await items.evaluateAll((els) =>
      els.map((el) => {
        const li = el.getBoundingClientRect();
        const card = el.querySelector("a.summary-card")!.getBoundingClientRect();
        const origs = el.querySelectorAll(".bc-orig");
        const orig = origs[0]?.getBoundingClientRect();
        return {
          slug: el.getAttribute("data-browse-item"),
          y: Math.round(li.top),
          h: li.height,
          cardH: card.height,
          origCount: origs.length,
          origH: orig?.height ?? 0,
          origText: (origs[0]?.textContent ?? "").trim(),
        };
      }),
    );
    for (const i of info) {
      expect(i.origCount, i.slug ?? "").toBe(1);
      expect(i.origH, i.slug ?? "").toBeGreaterThanOrEqual(19);
      // 卡片撐滿格子（格子邊框內側；容許 borders 的 2px 與小數誤差）
      expect(Math.abs(i.h - i.cardH), i.slug ?? "").toBeLessThanOrEqual(3);
    }
    // 有譯名的 hero 顯示原文；沒有譯名的留空
    expect(info.find((i) => i.slug === FIXTURE.hero.slug)!.origText).toBe(FIXTURE.hero.name);
    expect(info.some((i) => i.origText === "")).toBe(true);
    // 同一列（y 相同）的卡片高度相同
    const rows = new Map<number, number[]>();
    for (const i of info) rows.set(i.y, [...(rows.get(i.y) ?? []), i.h]);
    for (const [y, hs] of rows) expect(Math.max(...hs) - Math.min(...hs), `row y=${y}`).toBeLessThanOrEqual(1);
  });

  test("分組檢視：每張卡都有第二行（原文／空白）；有譯名的顯示原文並標 lang=en；卡片大小一致", async ({ page }) => {
    await page.goto(`/zh-Hant/games?q=${FIXTURE_3B.searchTerm}&by=date&gfrom=2030-01`);
    const hero = page.locator(`li.rc-card:has(a[href="/zh-Hant/games/${FIXTURE.hero.slug}"])`).first();
    await expect(hero.locator(".rc-name")).toHaveText(FIXTURE.hero.zhName);
    await expect(hero.locator(".rc-orig")).toHaveText(FIXTURE.hero.name);
    await expect(hero.locator(".rc-orig")).toHaveAttribute("lang", "en");
    const cards = page.locator("li.rc-card");
    const info = await cards.evaluateAll((els) =>
      els.map((el) => ({
        w: el.querySelector("a")!.getBoundingClientRect().width,
        h: el.querySelector("a")!.getBoundingClientRect().height,
        origCount: el.querySelectorAll(".rc-orig").length,
        origH: el.querySelector(".rc-orig")!.getBoundingClientRect().height,
        origText: (el.querySelector(".rc-orig")!.textContent ?? "").trim(),
      })),
    );
    expect(info.length).toBeGreaterThan(1);
    for (const i of info) {
      expect(i.origCount).toBe(1);
      expect(i.origH).toBeGreaterThanOrEqual(14);
      expect(Math.abs(i.h - info[0]!.h)).toBeLessThanOrEqual(1);
      expect(Math.abs(i.w - info[0]!.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(i.origH - info[0]!.origH)).toBeLessThanOrEqual(0.5);
    }
    expect(info.some((i) => i.origText === "")).toBe(true);
  });
});

test.describe("依日期分組：起算月與跳到年月", () => {
  test("指定 gfrom：結束月 ≥ 起算月的組由舊到新，日期未定最後；更早的組不列", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    await expectKeys(page, ["2036-Q4", "2037", "tbd"]);
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-09`);
    await expectKeys(page, [...F.dateGroups]);
    // 不合法的值＝預設（當月起的順序）
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-13`);
    await expectKeys(page, [...F.dateGroups]);
  });

  test("「往前看較早的月份」連結：從起算月往前一頁（6 個月），預設（沒有 gfrom）從當月往前；點了就換起算月", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    const earlier = page.locator("[data-rc-earlier]");
    await expect(earlier).toHaveAttribute("data-rc-earlier", "2036-04");
    await expect(earlier).toHaveAttribute("href", `/en/games?q=${F.q}&by=date&gfrom=2036-04`);
    await expect(earlier).toHaveText(msg("en", "ui.games.dateNav.earlier", { month: "2036-04" }));
    await earlier.click();
    await expect(page).toHaveURL(new RegExp(`gfrom=2036-04$`));
    await expectKeys(page, [...F.dateGroups]);
    await expect(page.locator("[data-rc-earlier]")).toHaveAttribute("data-rc-earlier", "2035-10");

    // 預設（沒有 gfrom）：連結從「本月」往前
    await page.goto(`${URL_ALL}&by=date`);
    const href = await page.locator("[data-rc-earlier]").getAttribute("href");
    expect(href).toMatch(new RegExp(`^/en/games\\?q=${F.q}&by=date&gfrom=\\d{4}-\\d{2}$`));
    // 不是第 1 頁就不顯示（分頁往後翻，不是往前看）
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-04&page=2`);
    await expect(page.locator("[data-rc-earlier]")).toHaveCount(0);
  });

  test("跳到年月：年、月下拉＋前往（GET 表單）；起算月之後的組由舊到新", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date`);
    const form = page.locator("[data-rc-jump]");
    await expect(form.getByRole("button", { name: msg("en", "ui.games.dateNav.go") })).toBeVisible();
    await form.locator("select[name=gyear]").selectOption("2030");
    await form.locator("select[name=gmonth]").selectOption("3");
    await form.getByRole("button", { name: msg("en", "ui.games.dateNav.go") }).click();
    await expect(page).toHaveURL(new RegExp(`gmonth=3&gyear=2030`));
    await expectKeys(page, [...F.dateGroups]);
    await expect(page.locator("select[name=gyear]")).toHaveValue("2030");
    await expect(page.locator("select[name=gmonth]")).toHaveValue("3");
    // 頁面自己產生的連結一律是正規的 gfrom
    await expect(page.locator("[data-rc-earlier]")).toHaveAttribute("href", `/en/games?q=${F.q}&by=date&gfrom=2029-09`);
    await expect(page.locator("[data-rc-datenav]")).toContainText("2030-03");
  });

  test("沒有 JS：往前看是連結、跳月是 GET 表單，都能用", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    await expectKeys(page, ["2036-Q4", "2037", "tbd"]);
    await page.locator("[data-rc-earlier]").click();
    await expect(page).toHaveURL(/gfrom=2036-04$/);
    await expectKeys(page, [...F.dateGroups]);
    await page.locator("select[name=gyear]").selectOption("2031");
    await page.locator("select[name=gmonth]").selectOption("12");
    await page.locator("[data-rc-jump] button[type=submit]").click();
    await expect(page).toHaveURL(/gmonth=12&gyear=2031/);
    await expectKeys(page, [...F.dateGroups]);
    await ctx.close();
  });

  test("搜尋與篩選送出時保留起算月；切到其他分組不帶 gfrom", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date&gfrom=2036-10`);
    await page.locator(".filter-form button.btn-primary").first().click();
    await expect(page).toHaveURL(/gfrom=2036-10/);
    await expectKeys(page, ["2036-Q4", "2037", "tbd"]);
    await expect(switchReady(page)).toBeVisible();
    await page.getByRole("radio", { name: msg("en", "ui.games.by.platform") }).check();
    await expect(page).toHaveURL(/by=platform$/);
  });
});

test.describe("組內順序固定、sort 不適用於分組檢視", () => {
  test("分組檢視隱藏排序欄位（不分組時有）；網址帶 sort 也不影響組內順序，顯示更多的 API 請求不帶 sort", async ({ page }) => {
    await page.goto(URL_ALL);
    await expect(page.locator("select[name=sort]")).toHaveCount(1);
    await page.goto(`${URL_ALL}&by=date&sort=name`);
    await expect(page.locator("select[name=sort]")).toHaveCount(0);
    const first = section(page, "2036-09").locator("li.rc-card");
    await expect(first.nth(0)).toContainText(F.capcom.name); // 仍是發售日由新到舊，不是名稱 A→Z
    const more = section(page, "2036-09").locator("[data-rc-more]");
    await expect(more).toHaveAttribute("data-ready", "true");
    const request = page.waitForRequest((r) => r.url().includes("/api/v1/games/group"));
    await more.click();
    const url = new URL((await request).url());
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.has("gsort")).toBe(false);
    expect(url.searchParams.has("gfrom")).toBe(false);
    // 搜尋表單仍帶著 sort（切回不分組時還在）
    await expect(page.locator("input[type=hidden][name=sort]").first()).toHaveValue("name");
  });
});

test.describe("依平台／依廠商的組排序", () => {
  test("依平台：預設最新發售日由新到舊；連結不寫預設值；最新／數量／名稱 × 升降冪", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=platform`);
    await expectKeys(page, ["e2e-pc", "e2e-ps5", "e2e-switch"]);
    const nav = page.locator("[data-rc-order]");
    await expect(nav.locator('[data-rc-gsort="latest"]')).toHaveAttribute("aria-current", "true");
    await expect(nav.locator('[data-rc-gdir="desc"]')).toHaveAttribute("aria-current", "true");
    await expect(nav.locator('[data-rc-gsort="latest"]')).toHaveAttribute("href", `/en/games?q=${F.q}&by=platform`);
    await expect(nav.locator('[data-rc-gdir="desc"]')).toHaveAttribute("href", `/en/games?q=${F.q}&by=platform`);
    await expect(nav.locator('[data-rc-gsort="count"]')).toHaveAttribute("href", `/en/games?q=${F.q}&by=platform&gsort=count`);
    await expect(nav.locator('[data-rc-gdir="asc"]')).toHaveAttribute("href", `/en/games?q=${F.q}&by=platform&gdir=asc`);

    await nav.locator('[data-rc-gdir="asc"]').click();
    await expect(page).toHaveURL(new RegExp(`by=platform&gdir=asc$`));
    await expectKeys(page, ["e2e-switch", "e2e-ps5", "e2e-pc"]);
    await expect(page.locator('[data-rc-gdir="asc"]')).toHaveAttribute("aria-current", "true");

    await page.locator('[data-rc-gsort="count"]').click();
    await expect(page).toHaveURL(new RegExp(`by=platform&gdir=asc&gsort=count$`));
    expect(await groupKeys(page)).toEqual(["e2e-switch", "e2e-ps5", "e2e-pc"]); // 1、2、40 款
    await page.locator('[data-rc-gdir="desc"]').click();
    await expectKeys(page, ["e2e-pc", "e2e-ps5", "e2e-switch"]);

    // 名稱：依顯示的組名排序
    await page.goto(`${URL_ALL}&by=platform&gsort=name&gdir=asc`);
    const titles = (await page.locator("section[data-rc-group] h2 span:first-child").allInnerTexts()).map((t) => t.trim());
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "en")));
    await page.goto(`${URL_ALL}&by=platform&gsort=name&gdir=desc`);
    const desc = (await page.locator("section[data-rc-group] h2 span:first-child").allInnerTexts()).map((t) => t.trim());
    expect(desc).toEqual([...titles].reverse());
  });

  test("依廠商：預設最新發售日由新到舊，「獨立／其他」永遠最後；排序保留在分頁／搜尋／切換分組的網址裡", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=publisher`);
    await expectKeys(page, ["capcom", "fromsoftware", "nintendo", "other"]);
    await page.locator('[data-rc-gdir="asc"]').click();
    await expectKeys(page, ["fromsoftware", "nintendo", "capcom", "other"]);
    await page.locator('[data-rc-gsort="name"]').click();
    await expect(page).toHaveURL(new RegExp(`by=publisher&gdir=asc&gsort=name$`));
    await expectKeys(page, ["capcom", "fromsoftware", "nintendo", "other"]);
    await page.locator('[data-rc-gdir="desc"]').click();
    await expectKeys(page, ["nintendo", "fromsoftware", "capcom", "other"]);
    // 搜尋表單送出後仍是同一個排序
    await page.locator(".filter-form button.btn-primary").first().click();
    await expect(page).toHaveURL(/gsort=name/);
    await expectKeys(page, ["nintendo", "fromsoftware", "capcom", "other"]);
    // 切到依平台：排序參數保留（平台與廠商共用）
    await expect(switchReady(page)).toBeVisible();
    await page.getByRole("radio", { name: msg("en", "ui.games.by.platform") }).check();
    await expect(page).toHaveURL(/by=platform&gsort=name$/);
  });

  test("依日期分組沒有組排序控制項；不合法的 gsort／gdir 退回預設", async ({ page }) => {
    await page.goto(`${URL_ALL}&by=date&gsort=name&gdir=asc`);
    await expect(page.locator("[data-rc-order]")).toHaveCount(0);
    await expectKeys(page, [...F.dateGroups]);
    await page.goto(`${URL_ALL}&by=publisher&gsort=bogus&gdir=up`);
    await expectKeys(page, ["capcom", "fromsoftware", "nintendo", "other"]);
    await expect(page.locator('[data-rc-gsort="latest"]')).toHaveAttribute("aria-current", "true");
  });

  test("三語：組排序與跳月的標籤都有翻譯", async ({ page }) => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      await page.goto(`/${locale}/games?q=${F.q}&by=publisher`);
      await expect(page.locator('[data-rc-gsort="count"]')).toHaveText(msg(locale, "ui.games.groupOrder.sort.count"));
      await expect(page.locator('[data-rc-gdir="asc"]')).toHaveText(msg(locale, "ui.games.groupOrder.dir.asc"));
      await page.goto(`/${locale}/games?q=${F.q}&by=date&gfrom=2036-10`);
      await expect(page.locator("[data-rc-earlier]")).toHaveText(msg(locale, "ui.games.dateNav.earlier", { month: "2036-04" }));
      await expect(page.locator("[data-rc-jump] button")).toHaveText(msg(locale, "ui.games.dateNav.go"));
    }
  });

  for (const path of [`${URL_ALL}&by=platform&gsort=count&gdir=asc`, `${URL_ALL}&by=date&gfrom=2036-10`]) {
    test(`axe：${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(switchReady(page)).toBeVisible();
      await expectNoA11yViolations(page, path);
    });
  }
});

test.describe("平台總覽：依平台發售日排序", () => {
  const slugs = (page: Page, kind: string): Promise<string[]> =>
    page.locator(`[data-platform-kind="${kind}"] li[data-platform]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-platform") ?? ""));

  test("預設新到舊；舊到新可切換；沒有日期的平台永遠最後；每個平台顯示發售日（取最早一筆）", async ({ page }) => {
    await page.goto("/en/platforms");
    // 主機組：PS5（2020-11-10）、Switch（2017-03-03，hybrid 同時在主機與掌機）
    expect(await slugs(page, "console")).toEqual(["e2e-ps5", "e2e-switch"]);
    await expect(page.locator('[data-platform-dir="desc"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-platform-dir="desc"]')).toHaveAttribute("href", "/en/platforms");
    await expect(page.locator('[data-platform-dir="asc"]')).toHaveAttribute("href", "/en/platforms?dir=asc");
    await expect(page.locator('li[data-platform="e2e-ps5"]').first()).toContainText(msg("en", "ui.platforms.releasedOn", { date: "" }).trim().split(" ")[0]!);
    await expect(page.locator('li[data-platform="e2e-ps5"]').first()).toContainText(/Nov(ember)?\s+10,?\s+2020|2020-11-10|10\s+Nov(ember)?\s+2020/);
    await expect(page.locator('li[data-platform="e2e-pc"]')).not.toContainText("Released");

    await page.locator('[data-platform-dir="asc"]').click();
    await expect(page).toHaveURL(/\/en\/platforms\?dir=asc$/);
    expect(await slugs(page, "console")).toEqual(["e2e-switch", "e2e-ps5"]);
    await expect(page.locator('[data-platform-dir="asc"]')).toHaveAttribute("aria-current", "true");

    // sort=release 是唯一（預設）值；不合法的 dir 退回新到舊
    await page.goto("/en/platforms?sort=release&dir=bogus");
    expect(await slugs(page, "console")).toEqual(["e2e-ps5", "e2e-switch"]);
  });

  test("三語標籤；語言切換保留 dir；平台頁自己的遊戲排序（sort=date|popularity|name）不受影響", async ({ page }) => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      await page.goto(`/${locale}/platforms?dir=asc`);
      await expect(page.locator('[data-platform-dir="desc"]')).toHaveText(msg(locale, "ui.platforms.order.desc"));
      await expect(page.locator('[data-platform-dir="asc"]')).toHaveText(msg(locale, "ui.platforms.order.asc"));
    }
    await page.goto("/en/platforms/e2e-ps5?section=all&sort=name");
    await expect(page.locator("[data-entity-games] li").first()).toBeVisible();
    expect(new URL(page.url()).search).toContain("sort=name");
  });

  test("axe：平台總覽（新到舊／舊到新）", async ({ page }) => {
    for (const path of ["/en/platforms", "/en/platforms?dir=asc"]) {
      await page.goto(path);
      await expectNoA11yViolations(page, path);
    }
  });
});
