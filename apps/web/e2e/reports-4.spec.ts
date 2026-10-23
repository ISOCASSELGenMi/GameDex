/**
 * Phase 4 Slice 2：資料更正回報（12）的端到端流程與 axe。
 * 流程（serial）：詳情頁「補充我所在地區的上市日」→ 表單送出 → /internal/reports（Basic auth）看到 → 核可 →
 * 詳情頁立即顯示 manual 的台灣上市日（ISR 快取被 revalidateTag 打掉）。
 * 另測：未帶帳密 401、缺 sourceUrl 的錯誤訊息、各入口、axe（表單頁、管理頁）。
 * 測試用的遊戲在 beforeAll 直接寫入測試資料庫（igdbId 4420xx、月份 2038-03，不影響其他測試的計數）。
 * 伺服器端的 Turnstile 驗證連到 Cloudflare siteverify（官方測試金鑰）；瀏覽器端的 widget 腳本在這裡以假腳本取代。
 */
import { formatReleaseLabel } from "@sok/i18n";
import pg from "pg";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, testDatabaseUrl } from "./support/env";
import { FIXTURE, FIXTURE_3B, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const GAME = { igdbId: 442001, slug: "e2e-report-game", name: "E2E Report Target Game", date: "2038-03-10" };
const TW_DATE = "2038-03-20";

// 假 widget：render／reset 之後都非同步地給一個 token（真的 reset 也會重新發 token）
const TURNSTILE_STUB = `(function () {
  var cb = null;
  function give() { setTimeout(function () { if (cb) cb("XXXX.DUMMY.TOKEN.XXXX"); }, 0); }
  window.turnstile = {
    render: function (el, o) { cb = o.callback; give(); return "stub-widget"; },
    reset: function () { give(); },
    remove: function () {}
  };
})();`;

let gameId = 0;
let ps5Id = 0;

test.beforeAll(async () => {
  // beforeAll 每個 worker 各跑一次：用 advisory lock 序列化，避免同時插入出現重複的上市列
  const c = new pg.Client({ connectionString: testDatabaseUrl() });
  await c.connect();
  try {
    await c.query("SELECT pg_advisory_lock(442001)");
    const plat = await c.query("SELECT id FROM platforms WHERE slug = $1", [FIXTURE.platformPs5]);
    ps5Id = plat.rows[0].id;
    const ww = await c.query("SELECT id FROM regions WHERE code = 'WW'");
    const g = await c.query(
      `INSERT INTO games (igdb_id, slug, name, game_type) VALUES ($1, $2, $3, 'main_game')
       ON CONFLICT (igdb_id) DO UPDATE SET name = excluded.name RETURNING id`,
      [GAME.igdbId, GAME.slug, GAME.name],
    );
    gameId = g.rows[0].id;
    await c.query("INSERT INTO game_platforms (game_id, platform_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [gameId, ps5Id]);
    const has = await c.query("SELECT 1 FROM release_events WHERE game_id = $1", [gameId]);
    if (has.rowCount === 0) {
      const ev = await c.query(
        `INSERT INTO release_events (game_id, platform_id, region_id, release_date, period_start, precision, release_stage, status, source, sequence)
         VALUES ($1, $2, $3, $4, $4, 'day', 'full', 'scheduled', 'igdb', 2) RETURNING id`,
        [gameId, ps5Id, ww.rows[0].id, GAME.date],
      );
      // 直接 insert 沒走寫入路徑：補預先計算的代表上市列（release_picks，平台頁「全部遊戲」用）
      await c.query(
        `INSERT INTO release_picks (game_id, platform_id, release_stage, release_event_id, release_date, precision)
         VALUES ($1, $2, 'full', $3, $4, 'day') ON CONFLICT DO NOTHING`,
        [gameId, ps5Id, ev.rows[0].id, GAME.date],
      );
    }
    await c.query("SELECT pg_advisory_unlock(442001)");
  } finally {
    await c.end();
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
});

const adminAuth = { httpCredentials: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } };
const L: TestLocale = "zh-Hant";

async function waitForForm(page: import("@playwright/test").Page, locale: TestLocale): Promise<void> {
  await expect(page.locator("[data-report-form]")).toBeVisible();
  // 假 widget 在 effect 內掛上後才會移除「載入中」＝客戶端已 hydrate
  await expect(page.getByText(msg(locale, "ui.report.captchaLoading"))).toBeHidden();
}

test.describe("回報流程（serial）", () => {
  test.describe.configure({ mode: "serial" });
  const note = `e2e-report-${Date.now()}`;

  test("詳情頁入口 → 表單：送出台灣上市日（missing_region_date）", async ({ page }) => {
    // 先開一次詳情頁，讓 ISR 快取有舊內容（核可後必須被更新）
    await page.goto(`/${L}/games/${GAME.slug}`);
    await expect(page.locator("main h1")).toHaveText(GAME.name);
    expect(await page.locator(".release-table tbody tr").count()).toBe(1);

    // 每列有「回報資料有誤」連結（可存取名稱含平台與地區）
    const rowLink = page.locator(".release-table tbody tr a", { hasText: msg(L, "ui.report.entry.row") });
    await expect(rowLink).toHaveAttribute("aria-label", /E2E PlayStation 5.*/);
    await expect(rowLink).toHaveAttribute("href", /\/report\?releaseEvent=\d+&type=wrong_date$/);

    await page.getByRole("link", { name: msg(L, "ui.report.entry.addRegion") }).click();
    await expect(page).toHaveURL(new RegExp(`/${L}/report\\?game=${GAME.slug}&type=missing_region_date$`));
    await expect(page.locator("main h1")).toHaveText(msg(L, "ui.report.title"));
    await waitForForm(page, L);

    await page.getByLabel(msg(L, "ui.report.field.platform"), { exact: true }).selectOption({ label: "E2E PlayStation 5" });
    await page.getByLabel(msg(L, "ui.report.field.region"), { exact: true }).selectOption("TW");
    await page.getByLabel(msg(L, "ui.report.field.date"), { exact: true }).fill(TW_DATE);
    await page.getByLabel(msg(L, "ui.report.field.sourceUrl"), { exact: true }).fill("https://example.com/e2e-tw-release");
    await page.getByLabel(msg(L, "ui.report.field.note"), { exact: true }).fill(note);
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByRole("status")).toContainText(msg(L, "ui.report.success.title"));
    await expect(page.getByRole("link", { name: msg(L, "ui.report.success.backTo", { name: GAME.name }) })).toBeVisible();
  });

  test("管理頁（Basic auth）看到回報、axe 無違規 → 核可", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      const res = await page.goto("/internal/reports");
      expect(res?.status()).toBe(200);
      expect(res?.headers()["cache-control"]).toBe("no-store");
      await expect(page.locator("main h1")).toHaveText("資料更正回報");
      const card = page.locator("article", { hasText: note });
      await expect(card).toBeVisible();
      await expect(card).toContainText("TW");
      await expect(card).toContainText("https://example.com/e2e-tw-release");
      await expect(card).toContainText(GAME.name);
      await expectNoA11yViolations(page, "管理頁（待處理佇列）");
      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoA11yViolations(page, "管理頁（手機）");
      await page.setViewportSize({ width: 1280, height: 800 });

      await card.getByLabel("處理備註（選填）").fill("e2e 核可");
      await card.getByRole("button", { name: "核可" }).click();
      await expect(page).toHaveURL(/\/internal\/reports\?done=accept&id=\d+&applied=created$/);
      await expect(page.getByRole("status")).toContainText("已核可");
      await expect(page.locator("article", { hasText: note })).toHaveCount(0); // 不在待處理佇列了
      await page.goto("/internal/reports?status=accepted");
      await expect(page.locator("article", { hasText: note })).toContainText("e2e 核可");
    } finally {
      await ctx.close();
    }
  });

  test("詳情頁立即顯示 manual 的台灣上市日", async ({ page }) => {
    await page.goto(`/${L}/games/${GAME.slug}`);
    const rows = page.locator(".release-table tbody tr");
    await expect(rows).toHaveCount(2);
    const tw = rows.filter({ hasText: msg(L, "enums.region.TW") });
    await expect(tw).toHaveCount(1);
    await expect(tw).toContainText(formatReleaseLabel(TW_DATE, "day", L));
    // 原本的 WW 列不受影響
    await expect(rows.filter({ hasText: msg(L, "enums.region.WW") })).toContainText(formatReleaseLabel(GAME.date, "day", L));
  });

  test("管理頁：同一筆不能重複處理（已處理的沒有表單）", async ({ browser }) => {
    const ctx = await browser.newContext(adminAuth);
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/reports?status=accepted");
      const card = page.locator("article", { hasText: note });
      await expect(card).toBeVisible();
      await expect(card.getByRole("button")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("管理介面存取控制", () => {
  test("未帶帳密 401（含 WWW-Authenticate）、錯誤帳密 401、POST 也 401", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    try {
      const noAuth = await api.get("/internal/reports");
      expect(noAuth.status()).toBe(401);
      expect(noAuth.headers()["www-authenticate"]).toMatch(/^Basic /);
      expect(noAuth.headers()["cache-control"]).toBe("no-store");
      const wrong = await api.get("/internal/reports", { headers: { Authorization: `Basic ${Buffer.from("e2e-admin:wrong").toString("base64")}` } });
      expect(wrong.status()).toBe(401);
      const post = await api.post("/internal/reports/1", { form: { action: "accept", csrf: "x" }, headers: { Origin: baseURL! } });
      expect(post.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test("有帳密但沒有 CSRF token 或跨站 Origin → 403", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL, httpCredentials: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } });
    try {
      const noToken = await api.post("/internal/reports/1", { form: { action: "reject" }, headers: { Origin: baseURL! } });
      expect(noToken.status()).toBe(403);
      const cross = await api.post("/internal/reports/1", { form: { action: "reject", csrf: "1.x" }, headers: { Origin: "https://evil.example" } });
      expect(cross.status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });
});

test.describe("表單驗證與入口", () => {
  test("日期類缺來源網址：顯示欄位錯誤，不送出成功", async ({ page }) => {
    await page.goto(`/${L}/report?game=${GAME.slug}&type=missing_region_date`);
    await waitForForm(page, L);
    await page.getByLabel(msg(L, "ui.report.field.platform"), { exact: true }).selectOption({ label: "E2E PlayStation 5" });
    await page.getByLabel(msg(L, "ui.report.field.region"), { exact: true }).selectOption("JP");
    await page.getByLabel(msg(L, "ui.report.field.date"), { exact: true }).fill("2038-04-01");
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.locator("[data-report-error]")).toContainText(msg(L, "ui.report.errors.summary"));
    const url = page.getByLabel(msg(L, "ui.report.field.sourceUrl"), { exact: true });
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[id$='-sourceUrl-err']")).toHaveText(msg(L, "ui.report.errors.required"));
    await expect(page.locator("[data-report-success]")).toHaveCount(0);
    // 不是 http(s) 的網址 → invalid
    await url.fill("javascript:alert(1)");
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.locator("[id$='-sourceUrl-err']")).toHaveText(msg(L, "ui.report.errors.invalid"));
  });

  test("切換回報類型會換欄位；英文與日文頁面文字來自字典", async ({ page }) => {
    for (const locale of ["en", "ja"] as const) {
      await page.goto(`/${locale}/report?game=${GAME.slug}`);
      await waitForForm(page, locale);
      await page.getByLabel(msg(locale, "ui.report.field.type"), { exact: true }).selectOption("language_support");
      await expect(page.getByLabel(msg(locale, "ui.report.field.language"), { exact: true })).toBeVisible();
      await expect(page.getByLabel(msg(locale, "ui.report.field.supportType"), { exact: true })).toBeVisible();
      await expect(page.getByLabel(msg(locale, "ui.report.field.date"), { exact: true })).toHaveCount(0);
      await expect(page.locator("main h1")).toHaveText(msg(locale, "ui.report.title"));
    }
  });

  test("目標不存在或沒帶目標 → 軟 404（notFound 版面＋noindex，與其他頁相同）；表單頁 noindex 且不送 Set-Cookie", async ({ page }) => {
    for (const q of ["", "?game=no-such-game-zzz", "?releaseEvent=99999999", "?platform=nope", "?event=nope", "?releaseEvent=abc"]) {
      await page.goto(`/${L}/report${q}`);
      await expect(page.locator("main h1"), q).toHaveText(msg(L, "errors.notFound.title"));
      await expect(page.locator("[data-report-form]"), q).toHaveCount(0);
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first(), q).toBeAttached();
    }
    const ok = await page.request.get(`/${L}/report?game=${GAME.slug}`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["set-cookie"]).toBeUndefined();
    await page.goto(`/${L}/report?game=${GAME.slug}`);
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  });

  test("平台頁、活動頁、語言支援區各有入口", async ({ page }) => {
    await page.goto(`/${L}/platforms/${FIXTURE.platformPs5}`);
    await page.getByRole("link", { name: msg(L, "ui.report.entry.platform") }).click();
    await expect(page).toHaveURL(new RegExp(`/report\\?platform=${FIXTURE.platformPs5}$`));
    await waitForForm(page, L);
    await expect(page.getByLabel(msg(L, "ui.report.field.type"), { exact: true }).locator("option")).toHaveCount(3);

    await page.goto(`/${L}/events/${FIXTURE_3B.events.showcase.slug}`);
    await page.getByRole("link", { name: msg(L, "ui.report.entry.event") }).click();
    await expect(page).toHaveURL(new RegExp(`/report\\?event=${FIXTURE_3B.events.showcase.slug}$`));
    await waitForForm(page, L);

    await page.goto(`/${L}/games/${FIXTURE_3B.langNone.slug}`);
    await page.getByRole("link", { name: msg(L, "ui.report.entry.addLanguage") }).click();
    await expect(page).toHaveURL(/type=language_support$/);
    await waitForForm(page, L);
    await expect(page.getByLabel(msg(L, "ui.report.field.type"), { exact: true })).toHaveValue("language_support");
  });
});

test.describe("axe：表單頁", () => {
  const MOBILE = { width: 375, height: 812 };
  for (const locale of ["zh-Hant", "en", "ja"] as const) {
    for (const type of ["missing_region_date", "language_support", "takedown"]) {
      test(`${locale} ${type}：桌機與手機`, async ({ page }) => {
        await page.goto(`/${locale}/report?game=${GAME.slug}&type=${type}`);
        await waitForForm(page, locale);
        await expectNoA11yViolations(page, `${locale} 表單 ${type} 桌機`);
        await page.setViewportSize(MOBILE);
        await expectNoA11yViolations(page, `${locale} 表單 ${type} 手機`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "手機寬度不可水平捲動").toBeLessThanOrEqual(0);
      });
    }
  }

  test("錯誤狀態與成功狀態也沒有違規（zh-Hant）", async ({ page }) => {
    await page.goto(`/${L}/report?game=${GAME.slug}&type=missing_region_date`);
    await waitForForm(page, L);
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.locator("[data-report-error]")).toBeVisible();
    await expectNoA11yViolations(page, "表單（錯誤狀態）");
  });

  test("詳情頁加入回報入口後仍無違規", async ({ page }) => {
    await page.goto(`/${L}/games/${GAME.slug}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expectNoA11yViolations(page, "詳情頁（含回報入口）");
  });
});
