/**
 * Phase 7 第 5～7 波細則（D83）e2e：公開清單頁 CDN 標頭、停權者畫面、遊玩紀錄的平台名稱、篩選區「我的遊戲」連結、
 * 月曆／時間軸卡片的追蹤按鈕（批次查詢）、實體頁追蹤人數、私人行事曆的類型篩選。
 */
import type { Page } from "@playwright/test";
import { FIXTURE, FIXTURE_3B, LOCALES, calendarUrl, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";
import { api, gameIdBySlug, horizontalOverflow, signedInUser, targetIdBySlug, withDb } from "./support/accounts";

const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);

async function makeList(page: Page, name: string, visibility: "public" | "unlisted" | "private", gameSlugs: string[] = []) {
  const created = await api<{ list: { id: number; shareToken: string | null } }>(page, "POST", "/api/v1/lists", { name, visibility });
  expect(created.status).toBe(201);
  for (const slug of gameSlugs) {
    const r = await api(page, "POST", `/api/v1/lists/${created.json.list.id}/games/${await gameIdBySlug(slug)}`);
    expect([200, 201]).toContain(r.status);
  }
  return created.json.list;
}

test.describe("公開清單頁的 CDN 快取（D83）", () => {
  test("public：public, s-maxage=60、無 Set-Cookie、HTML 無檢視者資訊；unlisted 維持 no-store＋noindex；不進 sitemap", async ({ page, request }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "listcache", "List Cache Owner");
    const pub = await makeList(page, "CDN picks", "public", [FIXTURE.hero.slug]);
    const unl = await makeList(page, "Unlisted CDN picks", "unlisted", [FIXTURE.hero.slug]);

    const anon = await request.get(`/${locale}/lists/${pub.id}`);
    expect(anon.status()).toBe(200);
    expect(anon.headers()["cache-control"]).toBe("public, s-maxage=60");
    expect(anon.headers()["set-cookie"]).toBeUndefined();
    // 帶登入 Cookie 的請求：同樣的標頭、沒有 Set-Cookie、HTML 沒有檢視者資訊
    const authed = await page.request.get(`/${locale}/lists/${pub.id}`);
    expect(authed.headers()["cache-control"]).toBe("public, s-maxage=60");
    expect(authed.headers()["set-cookie"]).toBeUndefined();
    const html = await authed.text();
    expect(html).toContain("CDN picks");
    expect(html).not.toContain(email);
    expect(html).not.toContain("data-owner-hint");

    // unlisted 分享頁：不可被共用快取，noindex
    const shared = await request.get(`/${locale}/lists/s/${unl.shareToken}`);
    expect(shared.status()).toBe(200);
    const cc = shared.headers()["cache-control"] ?? "";
    expect(cc).not.toMatch(/public|s-maxage/);
    expect(cc).toContain("no-store");
    expect(await shared.text()).toMatch(/<meta name="robots" content="noindex/);
    expect(shared.headers()["set-cookie"]).toBeUndefined();

    // sitemap 不含任何清單頁
    const idx = await (await request.get("/sitemap.xml")).text();
    const shards = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => new URL(x[1]!).pathname);
    expect(shards.length).toBeGreaterThan(0);
    for (const p of shards) {
      const body = await (await request.get(p)).text();
      expect(body, p).not.toMatch(/\/lists\//);
    }
  });
});

test.describe("停權者（D83）", () => {
  test("可登入；帳號頁只有說明、登出、匯出與刪除的入口；各子頁只顯示說明；寫入 API 403", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "suspended");
    await withDb((c) => c.query("UPDATE users SET suspended_at = now() WHERE email = $1", [email.toLowerCase()]));

    await page.goto(`/${locale}/account`);
    const notice = page.locator("[data-account-suspended]");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading", { name: m(locale, "suspended.title") })).toBeVisible();
    await expect(notice).toContainText(m(locale, "suspended.body"));
    await expect(notice.getByRole("link", { name: m(locale, "suspended.toPrivacy") })).toHaveAttribute("href", `/${locale}/account/privacy`);
    await expect(page.getByRole("button", { name: m(locale, "account.signOut"), exact: true })).toBeVisible();
    for (const key of ["account.tab.lists", "account.tab.follows", "account.tab.settings"]) {
      await expect(page.getByRole("link", { name: m(locale, key), exact: true }), key).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: m(locale, "account.linked") })).toHaveCount(0);
    await expectNoA11yViolations(page, "停權者 帳號頁");

    // 其他子頁：只有說明
    for (const sub of ["lists", "plays", "follows", "games", "calendar", "settings"]) {
      await page.goto(`/${locale}/account/${sub}`);
      await expect(page.locator("[data-account-suspended]"), sub).toBeVisible();
      await expect(page.locator("main form"), sub).toHaveCount(0);
    }

    // 隱私與資料：說明＋匯出＋刪除
    await page.goto(`/${locale}/account/privacy`);
    await expect(page.locator("[data-account-suspended]")).toBeVisible();
    await expect(page.getByRole("heading", { name: m(locale, "privacy.export.title") })).toBeVisible();
    await expect(page.getByRole("button", { name: m(locale, "privacy.export.json") })).toBeVisible();
    await expect(page.getByRole("heading", { name: m(locale, "privacy.delete.title") })).toBeVisible();
    await expectNoA11yViolations(page, "停權者 隱私與資料");

    // API：狀態、寫入 403、讀取與匯出 200
    expect((await api<{ suspended: boolean }>(page, "GET", "/api/v1/account")).json).toEqual({ suspended: true });
    const write = await api(page, "POST", "/api/v1/lists", { name: "nope" });
    expect(write.status).toBe(403);
    expect(write.json).toEqual({ code: "account_suspended" });
    expect((await page.request.get("/api/v1/account/export?format=json")).status()).toBe(200);
    expect((await page.request.get("/api/v1/lists")).status()).toBe(200);
  });

  test("停權者的私人 iCal 仍可下載；公開與分享連結清單對他人 404", async ({ page, request }) => {
    const email = await signedInUser(page, "suspended-hidden");
    const pub = await makeList(page, "Hidden pub", "public", [FIXTURE.hero.slug]);
    const unl = await makeList(page, "Hidden unl", "unlisted", [FIXTURE.hero.slug]);
    const feed = await api<{ feed: { url: string } }>(page, "GET", "/api/v1/calendar/feeds");
    const icsPath = new URL(feed.json.feed.url).pathname;
    expect((await request.get(`/en/lists/${pub.id}`)).status()).toBe(200);
    await withDb((c) => c.query("UPDATE users SET suspended_at = now() WHERE email = $1", [email.toLowerCase()]));
    const hidden = await request.get(`/en/lists/${pub.id}`);
    expect(await hidden.text()).toContain(msg("en", "errors.notFound.title"));
    expect(await (await request.get(`/en/lists/s/${unl.shareToken}`)).text()).toContain(msg("en", "errors.notFound.title"));
    const ics = await request.get(icsPath);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
  });
});

test.describe("遊玩紀錄列表顯示平台名稱（D83）", () => {
  test("有平台顯示名稱；沒有平台的不顯示", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "plays-platform");
    const platformId = await targetIdBySlug("platforms", FIXTURE.platformPs5);
    const name = await withDb(async (c) => (await c.query<{ name: string }>("SELECT name FROM platforms WHERE id = $1", [platformId])).rows[0]!.name);
    const withPlatform = await api<{ record: { id: number } }>(page, "POST", "/api/v1/play-records", { gameId: await gameIdBySlug(FIXTURE.hero.slug), status: "playing", platformId });
    expect(withPlatform.status).toBe(201);
    const without = await api<{ record: { id: number } }>(page, "POST", "/api/v1/play-records", { gameId: await gameIdBySlug(FIXTURE.monthPrecision.slug), status: "want_to_play" });
    expect(without.status).toBe(201);

    const list = await api<{ items: { id: number; platform: { id: number; name: string } | null }[] }>(page, "GET", "/api/v1/play-records?locale=en");
    expect(list.json.items.find((i) => i.id === withPlatform.json.record.id)?.platform).toMatchObject({ id: platformId, name });
    expect(list.json.items.find((i) => i.id === without.json.record.id)?.platform).toBeNull();

    await page.goto(`/${locale}/account/plays`);
    await expect(page.locator(`[data-record-id="${withPlatform.json.record.id}"]`)).toContainText(name);
    await expect(page.locator(`[data-record-id="${without.json.record.id}"]`)).not.toContainText(name);
    await expectNoA11yViolations(page, "遊玩紀錄列表 平台名稱");
  });
});

test.describe("篩選區的「我的遊戲」連結（D83）", () => {
  for (const locale of LOCALES) {
    test(`${locale} 月曆、時間軸、瀏覽頁都有連到 /account/games；伺服器 HTML 與使用者無關`, async ({ page, request }) => {
      for (const path of [calendarUrl(locale, FIXTURE.month), `/${locale}/timeline`, `/${locale}/games`]) {
        const html = await (await request.get(path)).text();
        expect(html, path).toContain('data-filter-link="my-games"');
        await page.goto(path);
        const link = page.locator('a[data-filter-link="my-games"]');
        await expect(link, path).toHaveText(m(locale, "mygames.filterLink"));
        await expect(link, path).toHaveAttribute("href", `/${locale}/account/games`);
      }
      await page.locator('a[data-filter-link="my-games"]').click();
      await page.waitForURL(`**/${locale}/account/games`);
    });
  }
});

/** 計算 me/follows/state 的請求（每次請求的 targets 清單）。 */
function trackStateRequests(page: Page): string[][] {
  const reqs: string[][] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/v1/me/follows/state") reqs.push((u.searchParams.get("targets") ?? "").split(","));
  });
  return reqs;
}

test.describe("月曆卡片的追蹤按鈕（D83）", () => {
  test("登入後一次批次查詢；追蹤／取消；重新整理保留；同一款遊戲在格子與議程共用狀態；伺服器 HTML 無使用者資訊；axe", async ({ page, request }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "card-cal");
    const reqs = trackStateRequests(page);
    await page.goto(calendarUrl(locale, FIXTURE.month));
    await expect.poll(() => reqs.length, "只有一次批次查詢").toBe(1);
    // 畫面上有幾個追蹤掛載點就查幾款：每個有遊戲的日期只顯示第一款，加上「本月未定日」的卡片（其餘款數切換時才出現，狀態由切換後的掃描補查）
    expect(reqs[0]!.length).toBe(await page.locator("[data-card-action-game]").count());
    expect(reqs[0]!.length).toBeGreaterThanOrEqual(3);
    expect(reqs[0]!.every((t) => /^game:\d+$/.test(t))).toBe(true);
    expect(new Set(reqs[0]).size, "不重複查同一款遊戲").toBe(reqs[0]!.length);

    const label = m(locale, "follow.cardAria", { name: FIXTURE.hero.name });
    const desktop = page.locator(".cal-grid").getByRole("button", { name: label });
    await expect(desktop).toBeVisible();
    await expect(desktop).toHaveAttribute("aria-pressed", "false");
    await expect(desktop).toHaveAttribute("tabindex", "0"); // 單款的格沒有群組停駐點：按鈕與連結直接在 Tab 順序
    // 款數 > 1 的格：Tab 進格之前，格內按鈕不進 Tab 順序（整格一個停駐點）
    await expect(page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"]`).getByRole("button", { name: m(locale, "follow.cardAria", { name: "Busy Day Game 01" }) })).toHaveAttribute("tabindex", "-1");
    await desktop.click();
    await expect(desktop).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-card-follow-status]")).toHaveText(m(locale, "follow.cardOn", { name: FIXTURE.hero.name }));
    const gameId = await gameIdBySlug(FIXTURE.hero.slug);
    const state = await api<{ items: { following: boolean }[] }>(page, "GET", `/api/v1/me/follows/state?targets=game:${gameId}`);
    expect(state.json.items[0]!.following).toBe(true);
    expect(reqs.length, "按下去不再打批次查詢").toBe(1);
    // 同一款遊戲的所有按鈕狀態一致
    const all = await page.locator(`button[aria-label="${label}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("aria-pressed")));
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(new Set(all)).toEqual(new Set(["true"]));
    await expectNoA11yViolations(page, "月曆 卡片追蹤按鈕");

    await page.reload();
    await expect.poll(() => reqs.length).toBe(2);
    await expect(page.locator(".cal-grid").getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    await page.locator(".cal-grid").getByRole("button", { name: label }).click();
    await expect(page.locator(".cal-grid").getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-card-follow-status]")).toHaveText(m(locale, "follow.cardOff", { name: FIXTURE.hero.name }));

    // 伺服器 HTML：只有空的掛載點，沒有按鈕、沒有使用者資訊、沒有 Set-Cookie
    const authed = await page.request.get(calendarUrl(locale, FIXTURE.month));
    expect(authed.headers()["set-cookie"]).toBeUndefined();
    const html = await authed.text();
    expect(html).toContain("data-card-action-game=");
    expect(html).not.toContain('data-card-follow="'); // 沒有按鈕（只有空的掛載點與一個空的 status 區）
    expect((await request.get(calendarUrl(locale, FIXTURE.month))).headers()["cache-control"]).toBe(authed.headers()["cache-control"]);
  });

  test("未登入：按鈕在，按下導到登入頁並帶回跳路徑；不打 me/follows/state", async ({ page }) => {
    const locale: TestLocale = "en";
    const reqs = trackStateRequests(page);
    await page.goto(calendarUrl(locale, FIXTURE.month));
    const btn = page.locator(".cal-grid").getByRole("button", { name: m(locale, "follow.cardAria", { name: FIXTURE.hero.name }) });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("data-card-follow", "anonymous");
    await btn.click();
    await page.waitForURL(`**/${locale}/login?next=*`);
    expect(new URL(page.url()).searchParams.get("next")).toBe(calendarUrl(locale, FIXTURE.month));
    expect(reqs).toHaveLength(0);
  });

  test("格內切換：新出現的遊戲補查追蹤狀態（只查新的那款）並可追蹤", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "card-cal-switch");
    const reqs = trackStateRequests(page);
    await page.goto(calendarUrl(locale, FIXTURE.month));
    await expect.poll(() => reqs.length).toBe(1);
    const busy = page.locator(`.cal-cell[data-date="${FIXTURE.busyDay}"]`);
    await busy.locator('[data-cal-nav="next"]').click();
    await expect(busy.locator(".cal-name")).toHaveText("Busy Day Game 02");
    const btn = busy.locator("[data-card-follow]");
    await expect(btn).toHaveAttribute("data-card-follow", /^(on|off)$/);
    await expect.poll(() => reqs.length).toBe(2);
    expect(reqs[1], "只補查新出現的那一款").toHaveLength(1);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-card-follow-status]")).toHaveText(m(locale, "follow.cardOn", { name: "Busy Day Game 02" }));
    // 切回第一款再切回來：不再查（已有狀態），按鈕仍是已追蹤
    await busy.locator('[data-cal-nav="prev"]').click();
    await busy.locator('[data-cal-nav="next"]').click();
    await expect(busy.locator("[data-card-follow]")).toHaveAttribute("aria-pressed", "true");
    expect(reqs).toHaveLength(2);
  });

  test("手機寬度：月曆格的按鈕 44px 以上、不水平溢出；axe", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await page.setViewportSize({ width: 320, height: 800 });
    await signedInUser(page, "card-cal-mobile");
    await page.goto(calendarUrl(locale, FIXTURE.month));
    const first = page.locator(".cal-grid [data-card-follow]").first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute("data-card-follow", /^(on|off)$/);
    const box = await first.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolations(page, "月曆 手機 卡片追蹤按鈕");
  });
});

test.describe("時間軸卡片的追蹤按鈕（D83）", () => {
  test("登入後一次批次查詢；切到下一週只查新出現的遊戲", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "card-tl");
    const reqs = trackStateRequests(page);
    await page.goto(`/${locale}/timeline?at=${FIXTURE_3B.timeline.bigDay}`);
    await expect.poll(() => reqs.length).toBe(1);
    const cards = page.locator(".tw-card");
    await expect(cards.first()).toBeVisible();
    await expect.poll(async () => page.locator(".tw-card [data-card-follow]").count()).toBe(await cards.count());
    const first = reqs[0]!;
    expect(first.length).toBeGreaterThanOrEqual(1);

    const btn = cards.first().locator("[data-card-follow]");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-card-follow-status]")).toContainText(/\S/);
    expect(await btn.evaluate((e) => (e as HTMLElement).getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    // 點按鈕時 Playwright 會把按鈕捲進視窗，捲動量隨載入時序而變；頁面上方的連結（例如「我的遊戲」）被捲到 sticky 標頭底下時，
    // axe 的 target-size 會判定「部分被遮住」而誤報。先捲回頂端，讓 axe 量到的版面是確定的。
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoA11yViolations(page, "時間軸 卡片追蹤按鈕");

    await page.locator("a[data-week-nav=next]").click();
    await expect(page.locator("[data-week-range]")).not.toHaveAttribute("data-week", /^2037-W10$/);
    await expect.poll(() => reqs.length, "切週：再一次批次查詢").toBe(2);
    expect(reqs[1]!.filter((t) => first.includes(t)), "只查新出現的遊戲").toEqual([]);
    await expect.poll(async () => page.locator(".tw-card [data-card-follow]").count()).toBe(await cards.count());
    // 回到前一週：先前按下的狀態還在
    await page.locator("a[data-week-nav=prev]").click();
    await expect(page.locator("[data-week-range]")).toHaveAttribute("data-week", "2037-W10");
    await expect(cards.first().locator("[data-card-follow]")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("平台、系列、公司、活動頁的追蹤人數（D83）", () => {
  test("達門檻才顯示（compact 格式、三語）；沒人追蹤的頁面不顯示", async ({ page, request }) => {
    const platformId = await targetIdBySlug("platforms", FIXTURE.platformSwitch);
    await withDb(async (c) => {
      await c.query(
        "INSERT INTO users (email, display_name) SELECT 'e2e-u7-cnt-' || g || '@example.com', 'cnt ' || g FROM generate_series(1, 10) g ON CONFLICT (email) DO NOTHING",
      );
      await c.query(
        "INSERT INTO follows (user_id, target_type, target_id) SELECT id, 'platform', $1 FROM users WHERE email LIKE 'e2e-u7-cnt-%@example.com' ON CONFLICT DO NOTHING",
        [platformId],
      );
    });
    const count = await request.get(`/api/v1/follows/count/platform/${platformId}`);
    expect((await count.json()).count).toBe(10);
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/platforms/${FIXTURE.platformSwitch}`);
      await expect(page.locator("[data-follow-count]")).toHaveText(m(locale, "follow.count", { count: new Intl.NumberFormat(locale, { notation: "compact" }).format(10) }));
    }
    await expectNoA11yViolations(page, "平台頁 追蹤人數");
    // 沒有人追蹤（低於門檻）：不顯示
    await page.goto(`/en/events/${FIXTURE_3B.events.expo.slug}`);
    await expect(page.getByRole("button", { name: m("en", "follow.button"), exact: true })).toBeVisible();
    await expect(page.locator("[data-follow-count]")).toHaveCount(0);
  });
});

test.describe("私人行事曆：類型篩選（D83）", () => {
  test("選擇類型、儲存、重新整理保留；後端 filterGenres 對應", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "feed-genres");
    await page.goto(`/${locale}/account/calendar`);
    const section = page.locator('[data-section="private-feed-genres"]');
    await expect(section).toBeVisible();
    await expect(section.getByText(m(locale, "feedcal.settings.genres"))).toBeVisible();
    const boxes = section.locator('input[type="checkbox"]');
    expect(await boxes.count()).toBeGreaterThan(1);
    const label = (await boxes.first().locator("xpath=following-sibling::span").innerText()).trim();
    await boxes.first().check();
    await page.getByRole("button", { name: m(locale, "feedcal.settings.save") }).click();
    await expect(page.getByText(m(locale, "feedcal.settings.saved"))).toBeVisible();
    const feed = await api<{ feed: { filterGenres: string[]; settingsVersion: number } }>(page, "GET", "/api/v1/calendar/feeds");
    expect(feed.json.feed.filterGenres).toHaveLength(1);
    expect(feed.json.feed.settingsVersion).toBe(1);

    await page.reload();
    await expect(section.getByLabel(label, { exact: true })).toBeChecked();
    await expectNoA11yViolations(page, "私人行事曆 類型篩選");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("評論可見度用詞（D83）", () => {
  for (const locale of LOCALES) {
    test(`${locale}：「關注我的人」與遊戲追蹤的用詞不同`, async ({ page }) => {
      await signedInUser(page, `vis-${locale}`);
      await page.goto(`/${locale}/account/settings`);
      const select = page.getByLabel(m(locale, "settings.defaultReviewVisibility"), { exact: true });
      await expect(select.locator("option", { hasText: m(locale, "play.visibility.followers") })).toHaveCount(1);
      expect(m(locale, "play.visibility.followers")).not.toBe(m(locale, "follow.button"));
    });
  }
});

