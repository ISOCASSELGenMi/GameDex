/**
 * Phase 4 評分區（05 §顯示規則、06）：有分數的遊戲顯示 IGDB 分數與樣本數；沒有分數（沒有列、score=NULL 列）的遊戲沒有分數區；
 * 三語各一頁；axe 0 違規；回應沒有 Set-Cookie；JSON-LD 的 aggregateRating 只用預設來源。
 * fixture：FIXTURE_4（support/fixture-data.ts）。目前只有 IGDB 一個來源 → 不出現來源設定 UI（兩個來源的情況見 unit 測試）。
 */
import { FIXTURE_4, LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

function expectedLine(locale: TestLocale): string {
  const { score } = FIXTURE_4.rated;
  const count: number = FIXTURE_4.rated.reviewCount;
  const reviews = msg(locale, count === 1 ? "ui.game.rating.reviewsOne" : "ui.game.rating.reviewsOther", { count });
  return msg(locale, "ui.game.rating.line", { source: msg(locale, "ui.game.rating.provider.igdb"), score, max: 100, reviews });
}

for (const locale of LOCALES) {
  test.describe(`評分區（${locale}）`, () => {
    test("有分數：顯示 IGDB 分數與樣本數，標 data-score-provider，沒有來源設定 UI", async ({ page }) => {
      const res = await page.goto(`/${locale}/games/${FIXTURE_4.rated.slug}`);
      expect(res?.status()).toBe(200);
      const section = page.locator("[data-ratings-section]");
      await expect(section).toHaveCount(1);
      await expect(section.getByRole("heading", { level: 2, name: msg(locale, "ui.game.sections.ratings") })).toBeVisible();
      const row = section.locator('[data-score-provider="igdb"]');
      await expect(row).toBeVisible();
      await expect(row).toHaveText(expectedLine(locale));
      await expect(row).toHaveAttribute("data-primary", "true");
      // 只有一個來源 → 不出現設定 UI
      await expect(section.locator("[data-rating-settings]")).toHaveCount(0);
      await expect(section.locator('[data-score-provider]:not([data-score-provider="igdb"])')).toHaveCount(0);
      // 水合之後仍然顯示
      await page.waitForLoadState("networkidle");
      await expect(row).toBeVisible();
    });

    test("沒有分數（沒有列／score=NULL 列）：沒有分數區，也沒有 0 分", async ({ page }) => {
      for (const slug of [FIXTURE_4.noRow.slug, FIXTURE_4.nullRow.slug]) {
        const res = await page.goto(`/${locale}/games/${slug}`);
        expect(res?.status()).toBe(200);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expect(page.locator("[data-ratings-section]"), slug).toHaveCount(0);
        await expect(page.locator("[data-score-provider]"), slug).toHaveCount(0);
        await expect(page.locator("#sec-ratings"), slug).toHaveCount(0);
      }
    });

    test("axe：有分數／無分數兩種頁面 0 違規（桌機與手機）", async ({ page }) => {
      for (const slug of [FIXTURE_4.rated.slug, FIXTURE_4.noRow.slug]) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`/${locale}/games/${slug}`);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expectNoA11yViolations(page, `${locale} ${slug} 桌機`);
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`/${locale}/games/${slug}`);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expectNoA11yViolations(page, `${locale} ${slug} 手機`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${slug} 手機不可水平捲動`).toBeLessThanOrEqual(0);
      }
    });
  });
}

test.describe("快取與結構化資料", () => {
  test("詳情頁回應沒有 Set-Cookie（評分偏好只存 localStorage）", async ({ request }) => {
    for (const slug of [FIXTURE_4.rated.slug, FIXTURE_4.noRow.slug]) {
      const res = await request.get(`/en/games/${slug}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["set-cookie"], slug).toBeUndefined();
    }
  });

  test("JSON-LD：有分數的遊戲輸出 aggregateRating（IGDB、count > 0）；無分數的省略", async ({ page }) => {
    const read = async (slug: string) => {
      await page.goto(`/en/games/${slug}`);
      const raws = await page.locator('script[type="application/ld+json"]').allTextContents();
      const game = raws.map((r) => JSON.parse(r) as Record<string, unknown>).find((j) => j["@type"] === "VideoGame");
      expect(game, slug).toBeDefined();
      return game!;
    };
    const rated = await read(FIXTURE_4.rated.slug);
    expect(rated.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: FIXTURE_4.rated.score,
      bestRating: 100,
      worstRating: 0,
      ratingCount: FIXTURE_4.rated.reviewCount,
    });
    expect(await read(FIXTURE_4.noRow.slug)).not.toHaveProperty("aggregateRating");
    expect(await read(FIXTURE_4.nullRow.slug)).not.toHaveProperty("aggregateRating");
  });

  test("localStorage 被偏好污染也不影響只有單一來源的頁面（沒有設定 UI、不白屏）", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("sok:scoreProviders", JSON.stringify(["metacritic_scrape"])));
    await page.goto(`/en/games/${FIXTURE_4.rated.slug}`);
    await expect(page.locator("main h1").first()).toBeVisible();
    // 讀到的偏好只保留這頁存在的來源（沒有 igdb）→ 依規格不退回沒選的來源：分數隱藏，並提示所選來源沒有分數
    await expect(page.locator('[data-score-provider="igdb"]')).toBeHidden();
    await expect(page.getByText(msg("en", "ui.game.rating.none"))).toBeVisible();
  });
});
