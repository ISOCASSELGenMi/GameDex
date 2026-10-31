/**
 * GameDex 第 2 輪 Z4B：遊戲詳情頁補資訊（About 區、其他版本、相關內容、故事／簡介展開、版本標註）。
 * fixture：seed-z4b.ts（主作 e2e-z4b-main 有版本、26 款 DLC、資料片、移植、本地化標題、別名、模式、視角、引擎、故事）。
 */
import { expect, expectNoA11yViolations, gameUrl, msg, test, type TestLocale } from "./support/helpers";
import { FIXTURE_Z4B as F } from "./support/fixture-z4b";
import type { Locator, Page } from "@playwright/test";

const main = (locale: TestLocale = "zh-Hant") => gameUrl(locale, F.main.slug);
const about = (page: Page): Locator => page.locator("[data-about]");
const item = (page: Page, key: string): Locator => page.locator(`[data-about-item="${key}"]`);
const related = (page: Page): Locator => page.locator("#related");
/** 展開後按鈕文字會變（收合相關內容），所以用 aria-controls 找。 */
const editionBtn = (page: Page): Locator => page.locator('button[aria-controls="related"]');

async function ready(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline).every((a) => a.playState !== "running"));
}

test.describe("About 區", () => {
  test("公司分三欄、類型模式視角引擎、空欄位不顯示（zh-Hant）", async ({ page }) => {
    await page.goto(main());
    await expect(about(page).getByRole("heading", { level: 2, name: msg("zh-Hant", "ui.game.about.title") })).toBeVisible();
    await expect(item(page, "main-developers")).toContainText("Z4B Dev Studio");
    await expect(item(page, "publishers")).toContainText("Z4B Publisher");
    // 協力開發商欄含 supporting 與 porting；porting 標「移植」
    await expect(item(page, "supporting-developers")).toContainText("Z4B Support Studio");
    await expect(item(page, "supporting-developers")).toContainText("Z4B Port Studio");
    await expect(item(page, "supporting-developers").locator(".about-tag")).toHaveText(msg("zh-Hant", "ui.game.about.portingTag"));
    await expect(item(page, "game-modes")).toContainText("單人");
    await expect(item(page, "game-modes")).toContainText("合作");
    await expect(item(page, "player-perspectives")).toContainText("第三人稱");
    await expect(item(page, "engines")).toContainText("Z4B In-house engine");
    // 沒資料的欄整欄不顯示
    await expect(item(page, "themes")).toHaveCount(0);
    await expect(item(page, "collection")).toHaveCount(0);
    await expect(item(page, "genres")).toHaveCount(0);
    // 資訊格是 <dl>
    expect(await about(page).locator("dl.about-grid").count()).toBe(1);
    expect(await item(page, "publishers").evaluate((el) => el.querySelector("dt")?.textContent)).toBe(msg("zh-Hant", "ui.game.about.publishers"));
  });

  test("各語言標題與其他稱呼（地區名三語、註記原文）", async ({ page }) => {
    await page.goto(main("en"));
    const titles = page.locator("[data-about-titles]");
    await expect(titles.getByRole("heading", { name: msg("en", "ui.game.about.localizedTitles") })).toBeVisible();
    await expect(titles).toContainText("Japan");
    await expect(titles.locator('dd[lang="ja"]')).toHaveText(F.localized[0].name);
    await expect(titles).toContainText("Korea");
    await expect(titles.locator('dd[lang="ko"]')).toHaveText(F.localized[1].name);
    await expect(titles.getByRole("heading", { name: msg("en", "ui.game.about.alternativeTitles") })).toBeVisible();
    await expect(titles).toContainText("Acronym:");
    await expect(titles).toContainText("Chinese title - traditional:");
    await expect(titles).toContainText(F.alternative[1].name);

    await page.goto(main("ja"));
    await expect(page.locator("[data-about-titles]")).toContainText("韓国");
    await page.goto(main("zh-Hant"));
    await expect(page.locator("[data-about-titles]")).toContainText("韓國");
  });

  test("沒有補資訊的遊戲：沒有 About 區、沒有其他版本列", async ({ page }) => {
    await page.goto(gameUrl("zh-Hant", F.plain.slug));
    await expect(page.getByRole("heading", { level: 1, name: F.plain.name })).toBeVisible();
    await expect(about(page)).toHaveCount(0);
    await expect(page.locator("[data-editions]")).toHaveCount(0);
    await expect(page.locator("#related")).toHaveCount(0);
    await expect(page.locator("[data-trailer]")).toHaveCount(0);
  });

  test("故事與簡介：More 展開、收合，aria-expanded 隨之變化", async ({ page }) => {
    await page.goto(main("en"));
    await ready(page);
    for (const id of ["about-story-text", "game-summary"]) {
      const text = page.locator(`#${id}`);
      const btn = page.locator(`button[aria-controls="${id}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(btn).toHaveText(msg("en", "ui.common.showMore"));
      const collapsed = (await text.boundingBox())!.height;
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      await expect(btn).toHaveText(msg("en", "ui.common.showLess"));
      await expect.poll(async () => (await text.boundingBox())!.height).toBeGreaterThan(collapsed * 1.5);
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect.poll(async () => (await text.boundingBox())!.height).toBeLessThanOrEqual(collapsed + 1);
    }
    await expect(page.locator("#about-story-text")).toContainText(F.storyStart);
    await expect(page.locator("#about-story-text")).toHaveAttribute("lang", "en");
  });
});

test.describe("其他版本與相關內容", () => {
  test("「查看另外 N 個版本」展開：分組、數量、還有 X 款、焦點移到標題", async ({ page }) => {
    await page.goto(main("zh-Hant"));
    await ready(page);
    const btn = editionBtn(page);
    await expect(btn).toHaveText(msg("zh-Hant", "ui.game.edition.seeMore", { count: F.relatedTotal }));
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(related(page)).toHaveAttribute("data-open", "false");
    await expect(related(page).getByRole("heading", { name: msg("zh-Hant", "ui.game.related.title") })).toBeHidden();

    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(related(page)).toHaveAttribute("data-open", "true");
    const title = page.locator("#related-title");
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();

    const rel = (key: string) => msg("zh-Hant", `enums.relatedGroup.${key}`);
    const groupTitle = (key: string, count: number) => msg("zh-Hant", "ui.game.related.groupTitle", { group: rel(key), count });
    const keys = await related(page).locator("[data-related-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-related-group")));
    expect(keys).toEqual(["editions", "dlcs", "expansions", "ports"]);
    await expect(related(page).getByRole("heading", { level: 3, name: groupTitle("editions", 1) })).toBeVisible();
    await expect(related(page).getByRole("heading", { level: 3, name: groupTitle("dlcs", F.dlc.count) })).toBeVisible();
    await expect(related(page).getByRole("heading", { level: 3, name: groupTitle("expansions", 1) })).toBeVisible();
    await expect(related(page).getByRole("heading", { level: 3, name: groupTitle("ports", 1) })).toBeVisible();
    // DLC 組只列 24 款，其餘顯示「還有 2 款」
    const dlcGroup = related(page).locator('[data-related-group="dlcs"]');
    await expect(dlcGroup.locator("li")).toHaveCount(F.dlc.limit);
    await expect(dlcGroup.locator("[data-related-more]")).toHaveText(msg("zh-Hant", "ui.game.related.more", { count: F.dlc.count - F.dlc.limit }));
    await expect(related(page).locator('[data-related-group="editions"] a')).toHaveAttribute("href", `/zh-Hant/games/${F.edition.slug}`);

    // 再按一次收合
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(related(page)).toHaveAttribute("data-open", "false");
    await expect(title).toBeHidden();
  });

  test("網址 #related 直接展開、焦點在標題", async ({ page }) => {
    await page.goto(`${main("en")}#related`);
    await expect(related(page)).toHaveAttribute("data-open", "true");
    await expect(page.locator("#related-title")).toBeFocused();
    await expect(editionBtn(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("收合時相關內容的連結不在 Tab 順序（visibility:hidden）", async ({ page }) => {
    await page.goto(main("en"));
    await ready(page);
    const visible = await related(page).locator("a").first().isVisible();
    expect(visible).toBe(false);
  });

  test("鍵盤：Tab 到按鈕按 Enter 展開", async ({ page }) => {
    await page.goto(main("en"));
    await ready(page);
    const btn = editionBtn(page);
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#related-title")).toBeFocused();
  });
});

test.describe("DLC 與版本頁的標註", () => {
  test("DLC：標註是本體的 DLC，連回本體；沒有「其他版本」列", async ({ page }) => {
    await page.goto(gameUrl("zh-Hant", `${F.dlc.prefix}01`));
    const notice = page.locator('[data-edition-notice="derived"]');
    await expect(notice).toContainText("這是《");
    await expect(notice).toContainText("DLC");
    await expect(notice.getByRole("link", { name: F.main.name })).toHaveAttribute("href", `/zh-Hant/games/${F.main.slug}`);
    await expect(page.locator("#related")).toHaveCount(0);

    await page.goto(gameUrl("en", `${F.dlc.prefix}01`));
    await expect(page.locator("[data-edition-notice]")).toHaveText(`Part of ${F.main.name}: DLC / Add-on`);
  });

  test("Switch 2 Edition：標註版本名稱並連回本體", async ({ page }) => {
    await page.goto(gameUrl("en", F.edition.slug));
    const notice = page.locator('[data-edition-notice="edition"]');
    await expect(notice).toHaveText(`This is the ${F.edition.versionTitle} of ${F.main.name}`);
    await expect(notice.getByRole("link", { name: F.main.name })).toHaveAttribute("href", `/en/games/${F.main.slug}`);
    await page.goto(gameUrl("zh-Hant", F.edition.slug));
    await expect(page.locator('[data-edition-notice="edition"]')).toContainText(`的 ${F.edition.versionTitle}`);
  });

  test("資料片、移植頁也標註", async ({ page }) => {
    await page.goto(gameUrl("en", F.expansion.slug));
    await expect(page.locator("[data-edition-notice]")).toHaveText(`Part of ${F.main.name}: Expansion`);
    await page.goto(gameUrl("en", F.port.slug));
    await expect(page.locator("[data-edition-notice]")).toContainText(F.main.name);
  });
});

test.describe("頁首", () => {
  test("上市日期（相對時間）、預告片連結、封面並排", async ({ page }) => {
    await page.goto(main("en"));
    const line = page.locator("[data-release-line]");
    await expect(line).toContainText(msg("en", "ui.game.sections.releaseDates"));
    await expect(line).toContainText("February 10, 2038");
    await expect(line).toContainText(/\(in \d+ (months|years)\)|\(in \d+ days\)/);
    const trailer = page.locator("[data-trailer]");
    await expect(trailer).toHaveAttribute("href", "https://www.youtube.com/watch?v=z4btrailer");
    await expect(trailer).toHaveAttribute("rel", /noopener/);
    // 封面與預告片同一列
    const cover = (await page.locator(".detail-cover").boundingBox())!;
    const tr = (await trailer.boundingBox())!;
    expect(Math.abs(cover.y + cover.height - (tr.y + tr.height))).toBeLessThan(40);
    expect(tr.x).toBeGreaterThan(cover.x + cover.width - 1);
  });

  test("相關內容區已不含舊的 DLC 區塊（沒有重複）", async ({ page }) => {
    await page.goto(main("en"));
    await expect(page.locator("#sec-dlc")).toHaveCount(0);
    await expect(page.locator("#sec-companies")).toHaveCount(0);
  });
});

test.describe("無障礙與響應式", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe：主作（收合與展開）${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(main("zh-Hant"));
      await ready(page);
      await expectNoA11yViolations(page, `主作收合 ${scheme}`);
      await editionBtn(page).click();
      await ready(page);
      await expectNoA11yViolations(page, `主作展開 ${scheme}`);
    });
  }

  test("axe：DLC、版本、一般遊戲、英文與日文", async ({ page }) => {
    for (const [locale, slug] of [
      ["zh-Hant", `${F.dlc.prefix}01`],
      ["en", F.edition.slug],
      ["ja", F.main.slug],
      ["en", F.plain.slug],
    ] as const) {
      await page.goto(gameUrl(locale, slug));
      await ready(page);
      await expectNoA11yViolations(page, `${locale}/${slug}`);
    }
  });

  test("320px：主作展開後沒有水平溢出", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(main("ja"));
    await ready(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await editionBtn(page).click();
    await ready(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    // 手機 About 為 1 欄
    const items = page.locator("[data-about-item]");
    const first = (await items.nth(0).boundingBox())!;
    const second = (await items.nth(1).boundingBox())!;
    expect(Math.abs(first.x - second.x)).toBeLessThan(2);
  });

  test("About 欄數：桌機 4 欄、平板 2 欄、手機 1 欄", async ({ page }) => {
    const cols = async (width: number): Promise<number> => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(main("en"));
      return page.locator("dl.about-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    };
    expect(await cols(1280)).toBe(4);
    expect(await cols(768)).toBe(2);
    expect(await cols(375)).toBe(1);
  });

  test("reduced-motion：展開收合沒有高度過渡，只留透明度", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(main("en"));
    await ready(page);
    const props = await related(page).evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(props).not.toContain("grid-template-rows");
    expect(props).toContain("opacity");
    const rm = await page.locator("#game-summary").evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(rm).not.toContain("max-height");
    await editionBtn(page).click();
    await expect(related(page)).toHaveAttribute("data-open", "true");
    await expect(page.locator("#related-title")).toBeVisible();
  });

  test("一般動態：高度過渡 ≤ 250ms、不用 transition: all", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(main("en"));
    const t = await related(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { prop: cs.transitionProperty, dur: cs.transitionDuration, fn: cs.transitionTimingFunction };
    });
    expect(t.prop).not.toContain("all");
    expect(t.prop).toContain("grid-template-rows");
    for (const d of t.dur.split(",")) expect(parseFloat(d)).toBeLessThanOrEqual(0.25);
    expect(t.fn).not.toContain("ease-in");
  });
});
