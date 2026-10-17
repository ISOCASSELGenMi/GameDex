/**
 * Phase 7 第 6 波畫面：追蹤按鈕（詳情頁、平台／活動／系列／公司頁）、我的追蹤、我的遊戲、私人行事曆、訂閱頁入口、熱度顯示。
 * 登入用 API（快）；資料用 API 或直接寫測試資料庫。伺服器 HTML 與使用者無關。
 */
import type { Page } from "@playwright/test";
import { E2E_BASE_URL } from "./support/env";
import { FIXTURE, FIXTURE_3B, LOCALES, expect, expectNoA11yViolations, gameUrl, msg, test, type TestLocale } from "./support/helpers";
import { api, gameIdBySlug, horizontalOverflow, seedFollowSignals, seedManualSteam, signedInUser, targetIdBySlug, userIdByEmail, withDb } from "./support/accounts";

const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);

type TargetType = "game" | "event" | "platform" | "franchise" | "company";

async function follow(page: Page, type: TargetType, id: number): Promise<void> {
  const res = await page.request.fetch(`/api/v1/follows/${type}/${id}`, { method: "PUT", headers: { origin: E2E_BASE_URL } });
  expect([200, 201], `追蹤 ${type}:${id}`).toContain(res.status());
}

async function followState(page: Page, type: TargetType, id: number): Promise<boolean> {
  const r = await api<{ items: { following: boolean }[] }>(page, "GET", `/api/v1/me/follows/state?targets=${type}:${id}`);
  expect(r.status).toBe(200);
  return r.json.items[0]!.following;
}

const ENTITY_PAGES = [
  { type: "platform" as const, table: "platforms" as const, path: "platforms", slug: FIXTURE.platformPs5 },
  { type: "event" as const, table: "events" as const, path: "events", slug: FIXTURE_3B.events.showcase.slug },
  { type: "franchise" as const, table: "franchises" as const, path: "franchises", slug: "e2e-aurora-saga" },
  { type: "company" as const, table: "companies" as const, path: "companies", slug: "e2e-northern-studio" },
];

test.describe("追蹤按鈕：詳情頁（未登入）", () => {
  for (const locale of LOCALES) {
    test(`${locale} 按鈕在、按下導到登入頁並帶回跳路徑`, async ({ page }) => {
      await page.goto(gameUrl(locale, FIXTURE.hero.slug));
      const btn = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
      await expect(btn).toBeEnabled(); // session 取得後才啟用（匿名）
      await expect(btn).toHaveAttribute("aria-pressed", "false");
      await btn.click();
      await page.waitForURL(`**/${locale}/login?next=*`);
      expect(new URL(page.url()).searchParams.get("next")).toBe(gameUrl(locale, FIXTURE.hero.slug));
    });
  }

  test("伺服器 HTML 與使用者無關：登入後回應仍無 Set-Cookie、不含使用者名稱與 data-follow 狀態", async ({ page, request }) => {
    const name = "追蹤快取檢查員W6";
    await signedInUser(page, "followcache", name);
    const url = gameUrl("zh-Hant", FIXTURE.hero.slug);
    const authed = await page.request.get(url);
    const anon = await request.get(url);
    expect(authed.headers()["set-cookie"]).toBeUndefined();
    expect(authed.headers()["cache-control"]).toBe(anon.headers()["cache-control"]);
    const html = await authed.text();
    expect(html).not.toContain(name);
    expect(html).toContain('data-follow-button="loading"');
    expect(html).not.toContain('data-follow-button="on"');
    expect(html).not.toContain('data-follow-button="off"');
  });
});

test.describe("追蹤按鈕：詳情頁（已登入）", () => {
  test("追蹤、重新整理後狀態保持、取消追蹤；後端狀態一致；axe", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "follow1");
    const gameId = await gameIdBySlug(FIXTURE.hero.slug);
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    const btn = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: m(locale, "follow.statusOn") })).toBeVisible();
    expect(await followState(page, "game", gameId)).toBe(true);
    await expectNoA11yViolations(page, "詳情頁 已追蹤");

    await page.reload();
    const again = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
    await expect(again).toHaveAttribute("aria-pressed", "true"); // 掛載後取得狀態
    await again.click();
    await expect(again).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status").filter({ hasText: m(locale, "follow.statusOff") })).toBeVisible();
    expect(await followState(page, "game", gameId)).toBe(false);
  });

  test("達每日上限：還原按鈕並顯示原因", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "followlimit");
    await page.route("**/api/v1/follows/game/*", async (route) => {
      if (route.request().method() === "PUT") await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: "follow_limit_reached" }) });
      else await route.continue();
    });
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    const btn = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "error.followLimit") })).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("追蹤與收藏分開：說明文案在、追蹤不會讓遊戲出現在清單", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "followsep");
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    await expect(page.getByText(m(locale, "game.notTracking"))).toBeVisible();
    const btn = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    const state = await api<{ lists: unknown[] }>(page, "GET", `/api/v1/me/games/${await gameIdBySlug(FIXTURE.hero.slug)}`);
    expect(state.json.lists.every((l) => (l as { contains: boolean }).contains === false)).toBe(true);
  });
});

test.describe("追蹤按鈕：平台、活動、系列、公司頁", () => {
  for (const e of ENTITY_PAGES) {
    test(`${e.type}：未登入導登入；登入後追蹤／取消、重新整理保持、axe`, async ({ page }) => {
      const locale: TestLocale = "en";
      const url = `/${locale}/${e.path}/${e.slug}`;
      await page.goto(url);
      const btn = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
      await expect(btn).toBeEnabled();
      await btn.click();
      await page.waitForURL(`**/${locale}/login?next=*`);
      expect(new URL(page.url()).searchParams.get("next")).toBe(url);

      await signedInUser(page, `follow-${e.type}`);
      const id = await targetIdBySlug(e.table, e.slug);
      await page.goto(url);
      await expect(page.locator('[data-slot="entity.actions"]')).toContainText(m(locale, e.type === "event" ? "follow.hint.event" : "follow.hint.group"));
      const on = page.getByRole("button", { name: m(locale, "follow.button"), exact: true });
      await expect(on).toBeEnabled();
      await on.click();
      await expect(on).toHaveAttribute("aria-pressed", "true");
      expect(await followState(page, e.type, id)).toBe(true);
      await expectNoA11yViolations(page, `${e.type} 頁 已追蹤`);
      await page.reload();
      await expect(page.getByRole("button", { name: m(locale, "follow.button"), exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: m(locale, "follow.button"), exact: true }).click();
      await expect(page.getByRole("button", { name: m(locale, "follow.button"), exact: true })).toHaveAttribute("aria-pressed", "false");
      expect(await followState(page, e.type, id)).toBe(false);
    });
  }

  test("伺服器 HTML 的 entity.actions 外殼與使用者無關", async ({ page, request }) => {
    await signedInUser(page, "entityhtml", "實體頁檢查員W6");
    const url = `/en/platforms/${FIXTURE.platformPs5}`;
    const authed = await (await page.request.get(url)).text();
    const anon = await (await request.get(url)).text();
    expect(authed).not.toContain("實體頁檢查員W6");
    expect(authed).toContain('data-follow-button="loading"');
    expect(anon).toContain('data-follow-button="loading"');
  });
});

test.describe("我的追蹤頁", () => {
  test("未登入顯示登入提示", async ({ page }) => {
    await page.goto("/en/account/follows");
    await expect(page.getByRole("heading", { name: m("en", "account.signedOutTitle") })).toBeVisible();
  });

  test("分頁籤、取消追蹤（樂觀）、孤兒項目、鍵盤切換；三語 axe；320 無水平溢出", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    const email = await signedInUser(page, "follows");
    const heroId = await gameIdBySlug(FIXTURE.hero.slug);
    const ps5 = await targetIdBySlug("platforms", FIXTURE.platformPs5);
    const ev = await targetIdBySlug("events", FIXTURE_3B.events.showcase.slug);
    await follow(page, "game", heroId);
    await follow(page, "platform", ps5);
    await follow(page, "event", ev);
    // 孤兒：目標已不存在（多型參照沒有 FK）
    const userId = await userIdByEmail(email);
    await withDb((c) => c.query("INSERT INTO follows (user_id, target_type, target_id) VALUES ($1, 'game', 2147480000)", [userId]));

    await page.goto(`/${locale}/account/follows`);
    await expect(page.getByTestId("follows-private-note")).toHaveText(m(locale, "follows.note"));
    const list = page.getByRole("list", { name: m(locale, "follows.listLabel", { type: m(locale, "follows.type.game") }) });
    await expect(list.locator("li")).toHaveCount(2);
    await expect(list.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();
    await expect(list.locator("li").filter({ hasText: m(locale, "follows.removed") })).toHaveCount(1);
    await expectNoA11yViolations(page, "我的追蹤 遊戲分頁");

    // 取消追蹤孤兒項目
    await list.locator("li", { hasText: m(locale, "follows.removed") }).getByRole("button", { name: new RegExp(m(locale, "follows.unfollow")) }).click();
    await expect(list.locator("li")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: m(locale, "follows.removed") })).toBeVisible();

    // 鍵盤：Tab 停在目前的分頁籤，右鍵移到「活動」（順序：遊戲、活動、平台…）
    const gameTab = page.getByRole("tab", { name: m(locale, "follows.type.game"), exact: true });
    await gameTab.focus();
    await page.keyboard.press("ArrowRight");
    const eventTab = page.getByRole("tab", { name: m(locale, "follows.type.event"), exact: true });
    await expect(eventTab).toBeFocused();
    await expect(eventTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: FIXTURE_3B.events.showcase.name })).toBeVisible();
    await page.getByRole("tab", { name: m(locale, "follows.type.platform"), exact: true }).click();
    await expect(page.getByRole("link", { name: /e2e-ps5|PS5|PlayStation/i }).first()).toBeVisible();
    await page.getByRole("tab", { name: m(locale, "follows.type.company"), exact: true }).click();
    await expect(page.getByText(m(locale, "follows.empty"))).toBeVisible();
    await expectNoA11yViolations(page, "我的追蹤 公司分頁（空）");

    // 取消追蹤活動：樂觀移除，後端同步
    await eventTab.click();
    await page.getByRole("button", { name: new RegExp(m(locale, "follows.unfollow")) }).click();
    await expect(page.getByText(m(locale, "follows.empty"))).toBeVisible();
    expect(await followState(page, "event", ev)).toBe(false);

    for (const l of LOCALES) {
      await page.goto(`/${l}/account/follows`);
      await expect(page.getByTestId("follows-private-note")).toBeVisible();
      await expectNoA11yViolations(page, `${l} 我的追蹤`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/account/follows`);
    await expect(page.getByTestId("follows-private-note")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("我的遊戲頁", () => {
  test("未登入顯示登入提示", async ({ page }) => {
    await page.goto("/en/account/games");
    await expect(page.getByRole("heading", { name: m("en", "account.signedOutTitle") })).toBeVisible();
  });

  test("追蹤／擁有／收藏／清單切換、日期範圍、網址同步；三語 axe；320 無水平溢出", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    const email = await signedInUser(page, "mygames");
    const heroId = await gameIdBySlug(FIXTURE.hero.slug);
    await follow(page, "game", heroId);
    await seedManualSteam(email, FIXTURE.hero.slug); // owned：hero 已比對
    const list = await api<{ list: { id: number } }>(page, "POST", "/api/v1/lists", { name: "我的 W6 清單", visibility: "private" });
    expect(list.status).toBe(201);
    const monthId = await gameIdBySlug(FIXTURE.monthPrecision.slug);
    expect((await api(page, "POST", `/api/v1/lists/${list.json.list.id}/games/${monthId}`)).status).toBeLessThan(300);

    await page.goto(`/${locale}/account/games`);
    const count = page.getByTestId("mygames-count");
    await expect(count).toHaveText(m(locale, "mygames.count", { count: 1 }));
    const gamesList = page.getByRole("list", { name: m(locale, "mygames.listLabel") });
    await expect(gamesList.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();
    await expect(page.getByText(m(locale, "mygames.followedHint"))).toBeVisible();
    // hero 的最近上市日（2036-05-15，day 精度）以長日期顯示
    await expect(gamesList.locator("li").first()).toContainText("2036");
    await expectNoA11yViolations(page, "我的遊戲 追蹤");

    await page.getByRole("radio", { name: m(locale, "mygames.source.owned") }).check();
    await expect(count).toHaveText(m(locale, "mygames.count", { count: 1 }));
    expect(new URL(page.url()).searchParams.get("mine")).toBe("owned");
    await expect(gamesList.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();

    await page.getByRole("radio", { name: m(locale, "mygames.source.collected") }).check();
    await expect(count).toHaveText(m(locale, "mygames.count", { count: 1 }));
    await expect(gamesList.getByRole("link", { name: FIXTURE.monthPrecision.name })).toBeVisible();

    await page.getByRole("radio", { name: m(locale, "mygames.source.list", { name: "我的 W6 清單" }) }).check();
    await expect(gamesList.getByRole("link", { name: FIXTURE.monthPrecision.name })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("mine")).toBe(`list:${list.json.list.id}`);

    // 重新整理保留來源
    await page.reload();
    await expect(page.getByRole("radio", { name: m(locale, "mygames.source.list", { name: "我的 W6 清單" }) })).toBeChecked();

    // 日期範圍：排除 → 空；清除 → 回來；to < from → 錯誤提示
    await page.getByRole("radio", { name: m(locale, "mygames.source.followed") }).check();
    await expect(gamesList.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();
    await page.getByLabel(m(locale, "mygames.from"), { exact: true }).fill("2040-01-01");
    await expect(page.getByText(m(locale, "mygames.empty"))).toBeVisible();
    await page.getByLabel(m(locale, "mygames.to"), { exact: true }).fill("2039-01-01");
    await expect(page.getByRole("alert").filter({ hasText: m(locale, "mygames.badRange") })).toBeVisible();
    await page.getByRole("button", { name: m(locale, "mygames.clearRange") }).click();
    await expect(gamesList.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();
    await page.getByLabel(m(locale, "mygames.from"), { exact: true }).fill("2036-05-01");
    await page.getByLabel(m(locale, "mygames.to"), { exact: true }).fill("2036-05-31");
    await expect(gamesList.getByRole("link", { name: FIXTURE.hero.zhName })).toBeVisible();

    for (const l of LOCALES) {
      await page.goto(`/${l}/account/games`);
      await expect(page.getByTestId("mygames-count")).toHaveText(m(l, "mygames.count", { count: 1 }));
      await expectNoA11yViolations(page, `${l} 我的遊戲`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/account/games`);
    await expect(page.getByTestId("mygames-count")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("私人行事曆頁", () => {
  test("未登入顯示登入提示，伺服器 HTML 不含任何私人網址", async ({ page, request }) => {
    await page.goto("/en/account/calendar");
    await expect(page.getByRole("heading", { name: m("en", "account.signedOutTitle") })).toBeVisible();
    const html = await (await request.get("/en/account/calendar")).text();
    expect(html).not.toContain("/ical/u/");
  });

  test("網址預設遮罩、顯示／隱藏、複製、設定儲存、重新產生需確認；feed 可下載", async ({ page, context }) => {
    const locale: TestLocale = "zh-Hant";
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signedInUser(page, "privfeed");
    const first = await api<{ feed: { id: number; url: string; settingsVersion: number } }>(page, "GET", "/api/v1/calendar/feeds");
    expect(first.status).toBe(200);
    const url1 = first.json.feed.url;
    const token1 = new URL(url1).pathname.split("/").pop()!.replace(/\.ics$/, "");

    await page.goto(`/${locale}/account/calendar`);
    await expect(page.getByTestId("feed-secret-warning")).toHaveText(m(locale, "feedcal.secretWarning"));
    const masked = page.getByTestId("feed-url-masked");
    await expect(masked).toBeVisible();
    expect(await page.content(), "遮罩時 token 不在 DOM 內").not.toContain(token1);
    await expect(page.getByTestId("feed-url")).toHaveCount(0);
    await expectNoA11yViolations(page, "私人行事曆 遮罩");

    // 顯示／隱藏
    await page.getByRole("button", { name: m(locale, "feedcal.show"), exact: true }).click();
    await expect(page.getByTestId("feed-url")).toHaveValue(url1);
    const hide = page.getByRole("button", { name: m(locale, "feedcal.hide"), exact: true });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await hide.click();
    await expect(page.getByTestId("feed-url")).toHaveCount(0);
    expect(await page.content()).not.toContain(token1);

    // 複製（不必先顯示）
    await page.getByRole("button", { name: m(locale, "feedcal.copy"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "feedcal.copied") })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url1);
    await expect(page.getByTestId("feed-url")).toHaveCount(0);

    // 設定：改名、關掉「相關活動」、勾 Beta 階段 → 儲存
    await page.getByLabel(m(locale, "feedcal.settings.name"), { exact: true }).fill("我的 E2E 日曆");
    await page.getByLabel(m(locale, "feedcal.settings.includeEvents"), { exact: true }).uncheck();
    await page.getByLabel(m(locale, "feedcal.stage.beta"), { exact: true }).check();
    await page.getByRole("button", { name: m(locale, "feedcal.settings.save"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "feedcal.settings.saved") })).toBeVisible();
    const after = await api<{ feed: { name: string; includeEvents: boolean; filterStages: string[]; settingsVersion: number } }>(page, "GET", "/api/v1/calendar/feeds");
    expect(after.json.feed).toMatchObject({ name: "我的 E2E 日曆", includeEvents: false, filterStages: ["beta"] });
    expect(after.json.feed.settingsVersion).toBeGreaterThan(first.json.feed.settingsVersion);
    // 沒變更再儲存
    await page.getByRole("button", { name: m(locale, "feedcal.settings.save"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "feedcal.settings.unchanged") })).toBeVisible();
    // 空名稱：欄位錯誤
    await page.getByLabel(m(locale, "feedcal.settings.name"), { exact: true }).fill("");
    await page.getByRole("button", { name: m(locale, "feedcal.settings.save"), exact: true }).click();
    await expect(page.getByText(m(locale, "error.field.required"))).toBeVisible();
    await page.getByLabel(m(locale, "feedcal.settings.name"), { exact: true }).fill("我的 E2E 日曆");

    // feed 可下載
    const dl = await page.request.get(new URL(url1).pathname);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"]).toContain("text/calendar");
    expect(dl.headers()["set-cookie"]).toBeUndefined();
    expect(await dl.text()).toContain("BEGIN:VCALENDAR");

    // 重新產生：先要確認，說明 30 天
    await page.getByRole("button", { name: m(locale, "feedcal.rotate.button"), exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: m(locale, "feedcal.rotate.confirm") })).toBeVisible();
    await page.getByRole("button", { name: m(locale, "common.cancel"), exact: true }).click();
    expect((await api<{ feed: { url: string } }>(page, "GET", "/api/v1/calendar/feeds")).json.feed.url).toBe(url1);
    await page.getByRole("button", { name: m(locale, "feedcal.rotate.button"), exact: true }).click();
    await page.getByRole("button", { name: m(locale, "feedcal.rotate.confirmButton"), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "feedcal.rotate.done") })).toBeVisible();
    const rotated = await api<{ feed: { url: string } }>(page, "GET", "/api/v1/calendar/feeds");
    const url2 = rotated.json.feed.url;
    expect(url2).not.toBe(url1);
    await expect(page.getByTestId("feed-url")).toHaveCount(0); // 重新產生後回到遮罩
    // 新網址有內容；舊網址 30 天內仍 200 但沒有任何事件
    const dl2 = await page.request.get(new URL(url2).pathname);
    expect(dl2.status()).toBe(200);
    expect(dl2.headers()["content-type"]).toContain("text/calendar");
    const old = await page.request.get(new URL(url1).pathname);
    expect(old.status()).toBe(200);
    expect(await old.text()).not.toContain("BEGIN:VEVENT");
  });

  test("三語 axe 與 320 寬無水平溢出（含展開網址與平台選項）", async ({ page }) => {
    await signedInUser(page, "privfeedaxe");
    for (const l of LOCALES) {
      await page.goto(`/${l}/account/calendar`);
      await expect(page.getByTestId("feed-url-masked")).toBeVisible();
      await expectNoA11yViolations(page, `${l} 私人行事曆`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/zh-Hant/account/calendar");
    await page.getByRole("button", { name: m("zh-Hant", "feedcal.show"), exact: true }).click();
    await expect(page.getByTestId("feed-url")).toBeVisible();
    await page.locator("details > summary").first().click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("帳號首頁入口與訂閱頁入口", () => {
  test("帳號首頁有追蹤、我的遊戲、私人行事曆三個入口", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "home");
    await page.goto(`/${locale}/account`);
    await expect(page.getByRole("link", { name: m(locale, "account.track.follows"), exact: true })).toHaveAttribute("href", `/${locale}/account/follows`);
    await expect(page.getByRole("link", { name: m(locale, "account.track.games"), exact: true })).toHaveAttribute("href", `/${locale}/account/games`);
    await expect(page.getByRole("link", { name: m(locale, "account.track.calendar"), exact: true })).toHaveAttribute("href", `/${locale}/account/calendar`);
  });

  test("訂閱頁：已登入出現私人入口、未登入不出現；伺服器 HTML 不含入口", async ({ page, request, browser }) => {
    const locale: TestLocale = "zh-Hant";
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/${locale}/subscribe`);
    await anonPage.waitForLoadState("networkidle");
    await expect(anonPage.locator('[data-section="private-feed"]')).toHaveCount(0);
    await anon.close();

    await signedInUser(page, "subscribe");
    await page.goto(`/${locale}/subscribe`);
    const entry = page.locator('[data-section="private-feed"]');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(m(locale, "follow.private.text"));
    await expect(entry.getByRole("link", { name: m(locale, "follow.private.link") })).toHaveAttribute("href", `/${locale}/account/calendar`);
    await expectNoA11yViolations(page, "訂閱頁 已登入");
    const html = await (await request.get(`/${locale}/subscribe`)).text();
    expect(html).not.toContain('data-section="private-feed"');
  });
});

test.describe("熱度顯示：追蹤人數、上升中、熱門榜依據", () => {
  test("詳情頁顯示「N 人追蹤」與「上升中」；沒有訊號的遊戲兩者都不出現", async ({ page }) => {
    const locale: TestLocale = "en";
    // 這款遊戲沒有其他測試造訪（詳情頁是 ISR 快取，先寫訊號再第一次請求）
    await seedFollowSignals("e2e-fill-05", { siteFollows: 25, siteFollows7d: 12 });
    await page.goto(gameUrl(locale, "e2e-fill-05"));
    await expect(page.locator("[data-follower-count]")).toHaveText(msg(locale, "ui.heat.followers", { count: "25" }));
    await expect(page.locator("[data-rising]")).toHaveText(msg(locale, "ui.heat.rising"));
    await expectNoA11yViolations(page, "詳情頁 追蹤人數與上升中");

    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    await expect(page.locator("[data-heat-follow]")).toHaveCount(0);
  });

  for (const locale of LOCALES) {
    test(`${locale} 熱門榜顯示排序依據（accounts 啟用＝站內追蹤）`, async ({ page }) => {
      await page.goto(`/${locale}/trending`);
      const note = page.locator("[data-ranked-by]");
      await expect(note).toHaveAttribute("data-ranked-by", "site_follows_7d");
      await expect(note).toHaveText(msg(locale, "ui.trending.rankedBy.site_follows_7d"));
    });
  }
});
