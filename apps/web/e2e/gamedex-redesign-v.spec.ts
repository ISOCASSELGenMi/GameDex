/**
 * GameDex 改版第 1 段（任務書 V）：
 * - 混合型平台（Switch）同時出現在「主機」與「掌機」兩組；篩選主機／掌機都含 hybrid；篩選面板的種類選項沒有獨立的「混合」。
 * - 活動時間：伺服器 HTML 是 UTC；client 端依使用者時區改寫（訪客＝瀏覽器時區，登入者＝帳號時區），下一行小字補 UTC。
 * - 站名三語（header、<title>）。
 * - ORG_HOME_URL／ORG_NAME：主伺服器沒設 → header／footer 都沒有；第二個伺服器（同一份建置）有設 → 兩處都有。
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { E2E_PORT, WEB_DIR, serverEnv } from "./support/env";
import { signedInUser, api } from "./support/accounts";
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const SITE_NAMES: Record<TestLocale, string> = { "zh-Hant": "遊戲圖鑑 GameDex", en: "GameDex", ja: "ゲーム図鑑 GameDex" };

test.describe("混合型平台雙掛（主機＋掌機）", () => {
  test("平台總覽：Switch 同時在主機與掌機兩組，沒有獨立的混合組", async ({ page }) => {
    await page.goto("/en/platforms");
    const consoleGroup = page.locator('[data-platform-kind="console"]');
    const handheldGroup = page.locator('[data-platform-kind="handheld"]');
    await expect(consoleGroup.locator('a[href="/en/platforms/e2e-switch"]')).toHaveCount(1);
    await expect(handheldGroup.locator('a[href="/en/platforms/e2e-switch"]')).toHaveCount(1);
    await expect(page.locator('[data-platform-kind="hybrid"]')).toHaveCount(0);
    await expect(consoleGroup.locator('a[href="/en/platforms/e2e-ps5"]')).toHaveCount(1);
    await expect(handheldGroup.locator('a[href="/en/platforms/e2e-ps5"]')).toHaveCount(0);
    await expectNoA11yViolations(page, "平台總覽 en");
  });

  test("篩選：種類選項是主機／掌機／PC…（沒有混合）；選主機或掌機都含 Switch 遊戲，選 PC 不含", async ({ page }) => {
    await page.goto("/en/games");
    const kinds = page.locator('input[name="platformKind"]');
    expect(await kinds.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["console", "handheld", "pc", "arcade", "other"]);
    const link = () => page.locator(`a[href$="/games/${FIXTURE.monthPrecision.slug}"]`);
    for (const kind of ["console", "handheld"]) {
      await page.goto(`/en/games?platformKind=${kind}&q=${encodeURIComponent(FIXTURE.monthPrecision.name)}`);
      await expect(link().first(), kind).toBeVisible();
    }
    await page.goto(`/en/games?platformKind=pc&q=${encodeURIComponent(FIXTURE.monthPrecision.name)}`);
    await expect(link()).toHaveCount(0);
  });
});

test.describe("活動時間：一行本地時間＋時區縮寫（不再有 UTC 行）", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  const EVENT = "/en/events/e2e-showcase-2036"; // 2036-05-12 17:00–18:30 UTC ＝ 東京 2036-05-13 02:00–03:30（GMT+9）

  test("伺服器 HTML 只有 UTC（無使用者資訊）；訪客掛載後改成瀏覽器時區並標 GMT+9，沒有 UTC 行", async ({ page, request }) => {
    const html = await (await request.get(EVENT)).text();
    expect(html).toContain("UTC");
    expect(html).not.toContain('data-event-time="utc"');
    await page.goto(EVENT);
    const info = page.locator("[data-event-info]");
    const local = info.locator('[data-event-time="local"]');
    await expect(local).toContainText("May 13, 2036");
    await expect(local).toContainText("2:00");
    await expect(local).toContainText("3:30");
    await expect(local).toContainText("GMT+9");
    await expect(local).not.toContainText("UTC");
    await expect(info.locator('[data-event-time="utc"]')).toHaveCount(0);
    // 無障礙：time 元素帶 ISO datetime（開始、結束）
    const stamps = await info.locator("time").evaluateAll((els) => els.map((e) => e.getAttribute("datetime")));
    expect(stamps).toEqual(["2036-05-12T17:00:00.000Z", "2036-05-12T18:30:00.000Z"]);
    await expectNoA11yViolations(page, "活動詳情（東京時區）");
  });

  test("活動列表與月曆、遊戲詳情的活動時間都改寫成本地時區（一行）", async ({ page }) => {
    await page.goto("/en/events?scope=all");
    const row = page.locator('[data-event="e2e-showcase-2036"]');
    await expect(row.locator('[data-event-time="local"]')).toContainText("May 13, 2036");
    await expect(row.locator('[data-event-time="local"]')).toContainText("GMT+9");
    await expect(row.locator('[data-event-time="utc"]')).toHaveCount(0);
    await page.goto("/en/calendar/2036-05");
    const cal = page.locator(".ev").filter({ hasText: "E2E Showcase 2036" }).first();
    await expect(cal.locator('[data-event-time="local"]').first()).toContainText("GMT+9");
    await page.goto(`/en/games/${FIXTURE.hero.slug}`);
    await expect(page.locator('[data-event-time="local"]').first()).toContainText("May 13, 2036");
    await expect(page.locator('[data-event-time="utc"]')).toHaveCount(0);
  });

  test("登入者用帳號時區（優先於瀏覽器時區）", async ({ page }) => {
    await signedInUser(page, "evtz-v");
    const res = await api(page, "PATCH", "/api/v1/account/preferences", { timezone: "America/New_York" });
    expect(res.status).toBe(200);
    await page.goto(EVENT);
    const info = page.locator("[data-event-info]");
    await expect(info.locator('[data-event-time="local"]')).toContainText("May 12, 2036");
    await expect(info.locator('[data-event-time="local"]')).toContainText("1:00");
    await expect(info.locator('[data-event-time="local"]')).toContainText("GMT-4");
    await expect(info.locator('[data-event-time="utc"]')).toHaveCount(0);
  });

  test("三語各自的格式", async ({ page }) => {
    const expected: Record<string, RegExp> = {
      "zh-Hant": /2036\/05\/13 02:00 GMT\+9/,
      ja: /2036\/05\/13 02:00 GMT\+9/,
      en: /May 13, 2036,? 2:00\s?AM GMT\+9/,
    };
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/events/e2e-showcase-2036`);
      const info = page.locator("[data-event-info]");
      await expect(info.locator('[data-event-time="local"]'), locale).toContainText(expected[locale]!);
    }
  });
});

test.describe("活動時間：UTC 瀏覽器", () => {
  test.use({ timezoneId: "UTC" });
  test("時區是 UTC → 一行，標 UTC", async ({ page }) => {
    await page.goto("/en/events/e2e-showcase-2036");
    const info = page.locator("[data-event-info]");
    await expect(info.locator('[data-event-time="local"]')).toContainText("May 12, 2036");
    await expect(info.locator('[data-event-time="local"]')).toContainText("UTC");
    await expect(info.locator('[data-event-time="utc"]')).toHaveCount(0);
  });
});

test.describe("站名 GameDex", () => {
  for (const locale of LOCALES) {
    test(`${locale}：header 品牌與 <title>`, async ({ page }) => {
      await page.goto(`/${locale}/platforms`);
      expect(msg(locale, "ui.site.name")).toBe(SITE_NAMES[locale]);
      await expect(page.getByRole("banner").getByRole("link", { name: SITE_NAMES[locale], exact: true })).toBeVisible();
      expect(await page.title()).toContain(SITE_NAMES[locale]);
      expect(await page.content()).not.toContain("SoK 遊戲月曆");
    });
  }
});

test.describe("組織首頁連結（ORG_HOME_URL）", () => {
  test("主伺服器沒設定 → header 與 footer 都沒有", async ({ page }) => {
    await page.goto("/en/platforms");
    await expect(page.locator("[data-org-link]")).toHaveCount(0);
  });

  test.describe("有設定（第二個伺服器，同一份建置）", () => {
    test.describe.configure({ mode: "serial" });
    const PORT = E2E_PORT + 60;
    const BASE = `http://localhost:${PORT}`;
    let server: ChildProcess | undefined;

    test.beforeAll(async () => {
      const nextBin = require.resolve("next/dist/bin/next", { paths: [WEB_DIR] });
      server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
        cwd: path.resolve(WEB_DIR),
        env: { ...serverEnv(), ORG_HOME_URL: "https://org.example.test/", ORG_NAME: "Example Org", PORT: String(PORT) },
        stdio: "ignore",
      });
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          if ((await fetch(`${BASE}/healthz`)).ok) break;
        } catch {
          // 還沒起來
        }
        if (Date.now() > deadline) throw new Error("ORG 伺服器沒有在 60 秒內啟動");
        await new Promise((r) => setTimeout(r, 500));
      }
    });
    test.afterAll(() => {
      server?.kill();
    });

    for (const locale of LOCALES) {
      test(`${locale}：header 與 footer 各一個連結，指向組織首頁`, async ({ page }) => {
        await page.goto(`${BASE}/${locale}/platforms`);
        const label = msg(locale, "ui.org.backTo", { name: "Example Org" });
        const head = page.locator('[data-org-link="header"]');
        const foot = page.locator('[data-org-link="footer"]');
        await expect(head).toHaveText(label);
        await expect(foot).toHaveText(label);
        await expect(head).toHaveAttribute("href", "https://org.example.test/");
        await expect(foot).toHaveAttribute("href", "https://org.example.test/");
        await expectNoA11yViolations(page, `ORG 連結 ${locale}`);
      });
    }
  });
});
