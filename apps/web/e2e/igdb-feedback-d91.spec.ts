/**
 * D91 待回饋 IGDB 清單（12 §待回饋 IGDB 清單）的端到端流程與 axe。
 * 流程（serial）：公開表單送出 localized_title → /internal/reports 核可（比對列、建立項目提示）→
 * /internal/igdb-feedback 清單（IGDB 連結、整理文字、狀態分頁、單筆與批次動作）→ 存取控制。
 * 測試遊戲在 beforeAll 直接寫入測試資料庫（igdbId 480001，另外直接寫三筆 pending 項目供批次測試）。
 */
import pg from "pg";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, testDatabaseUrl } from "./support/env";
import { FIXTURE, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const GAME = { igdbId: 480001, slug: "e2e-feedback-game", name: "E2E Feedback Target Game" };
const L: TestLocale = "zh-Hant";
const TITLE = `回饋測試標題${Date.now() % 100000}`;
const SEEDS = ["fb-seed-1", "fb-seed-2", "fb-seed-3"];

const TURNSTILE_STUB = `(function () {
  var cb = null;
  function give() { setTimeout(function () { if (cb) cb("XXXX.DUMMY.TOKEN.XXXX"); }, 0); }
  window.turnstile = { render: function (el, o) { cb = o.callback; give(); return "stub-widget"; }, reset: function () { give(); }, remove: function () {} };
})();`;

test.beforeAll(async () => {
  const c = new pg.Client({ connectionString: testDatabaseUrl() });
  await c.connect();
  try {
    await c.query("SELECT pg_advisory_lock(480001)");
    const plat = await c.query("SELECT id FROM platforms WHERE slug = $1", [FIXTURE.platformPs5]);
    const ps5 = plat.rows[0].id;
    const g = await c.query(
      `INSERT INTO games (igdb_id, slug, name, game_type) VALUES ($1, $2, $3, 'main_game')
       ON CONFLICT (igdb_id) DO UPDATE SET name = excluded.name RETURNING id`,
      [GAME.igdbId, GAME.slug, GAME.name],
    );
    const gameId = g.rows[0].id;
    await c.query("INSERT INTO game_platforms (game_id, platform_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [gameId, ps5]);
    const has = await c.query("SELECT 1 FROM igdb_feedback_items WHERE game_id = $1", [gameId]);
    if (has.rowCount === 0) {
      for (const [i, note] of SEEDS.entries()) {
        const r = await c.query(
          `INSERT INTO data_reports (target_type, target_id, report_type, status, note, source_url, resolved_at)
           VALUES ('game', $1, 'wrong_stage', 'accepted', $2, 'https://example.com/seed', now()) RETURNING id`,
          [gameId, note],
        );
        await c.query(
          `INSERT INTO igdb_feedback_items (report_id, game_id, igdb_game_id, game_slug, field, platform_id, region_code, stage, old_value, new_value, source_url, reporter_note)
           VALUES ($1, $2, $3, $4, 'stage', $5, 'WW', 'full', '{"stage":"full"}', $6, 'https://example.com/seed', $7)`,
          [r.rows[0].id, gameId, GAME.igdbId, GAME.slug, ps5, JSON.stringify({ stage: i === 0 ? "beta" : "demo" }), note],
        );
      }
    }
    await c.query("SELECT pg_advisory_unlock(480001)");
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

test.describe("待回饋 IGDB 流程（serial）", () => {
  test.describe.configure({ mode: "serial" });

  test("公開表單：送出繁中標題回報（localized_title）", async ({ page }) => {
    await page.goto(`/${L}/report?game=${GAME.slug}&type=localized_title`);
    await expect(page.locator("[data-report-form]")).toBeVisible();
    await expect(page.getByText(msg(L, "ui.report.captchaLoading"))).toBeHidden();
    await expect(page.getByLabel(msg(L, "ui.report.field.type"), { exact: true })).toHaveValue("localized_title");
    await expectNoA11yViolations(page, "回報表單（繁中標題）");
    const title = page.getByLabel(msg(L, "ui.report.field.title"), { exact: true });
    // 空白標題 → 欄位錯誤
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await title.fill(TITLE);
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByRole("status")).toContainText(msg(L, "ui.report.success.title"));
  });

  test("審核頁：比對列、核可後顯示已建立待回饋項目", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/reports");
      const card = page.locator("article", { hasText: TITLE });
      await expect(card).toBeVisible();
      await expect(card.locator("tbody tr", { hasText: "繁體中文標題" })).toContainText("（目前沒有繁中標題）");
      await expectNoA11yViolations(page, "審核頁（localized_title）");
      await card.getByRole("button", { name: "核可" }).click();
      await expect(page).toHaveURL(/\/internal\/reports\?done=accept&id=\d+$/);
      await page.goto("/internal/reports?status=accepted");
      await expect(page.locator("article", { hasText: TITLE }).locator("[data-feedback-created]")).toContainText("已建立待回饋 IGDB 項目");
    } finally {
      await ctx.close();
    }
  });

  test("詳情頁立即顯示新繁中標題（顯示名稱已重算）", async ({ page }) => {
    await page.goto(`/${L}/games/${GAME.slug}`);
    await expect(page.locator("main h1")).toContainText(TITLE);
  });

  test("清單頁：卡片內容、IGDB 連結、唯讀整理文字、axe", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      const res = await page.goto("/internal/igdb-feedback");
      expect(res?.status()).toBe(200);
      expect(res?.headers()["cache-control"]).toBe("no-store");
      expect(res?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.locator("main h1")).toHaveText("待回饋 IGDB");
      await expect(page.getByRole("navigation", { name: "內部頁面" }).getByRole("link", { name: "待回饋 IGDB" })).toHaveAttribute("aria-current", "page");
      const card = page.locator("article", { hasText: TITLE });
      await expect(card).toContainText("繁體中文標題");
      await expect(card).toContainText(`建議改為`);
      const igdb = card.getByRole("link", { name: `https://www.igdb.com/games/${GAME.slug}` });
      await expect(igdb).toHaveAttribute("target", "_blank");
      await expect(igdb).toHaveAttribute("rel", "noopener noreferrer");
      await expect(card.locator('a[href^="/internal/reports?status=accepted#report-"]')).toBeVisible();
      const paste = card.getByLabel(/可貼到 IGDB 的整理文字/);
      await expect(paste).toHaveAttribute("readonly", "");
      await expect(paste).toHaveValue(new RegExp(`https://www.igdb.com/games/${GAME.slug}[\\s\\S]*建議改為：${TITLE}`));
      // 狀態分頁含數量
      await expect(page.getByRole("navigation", { name: "項目狀態" })).toContainText("待回饋（");
      await expectNoA11yViolations(page, "待回饋 IGDB 清單");
      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoA11yViolations(page, "待回饋 IGDB 清單（手機）");
    } finally {
      await ctx.close();
    }
  });

  test("單筆動作：標為已提交 → 已提交分頁 → 改回待回饋", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/igdb-feedback");
      const card = page.locator("article", { hasText: TITLE });
      await card.getByLabel("處理備註（選填）").fill("e2e 已到 IGDB 提交");
      await card.getByRole("button", { name: "標為已提交" }).click();
      await expect(page).toHaveURL(/\/internal\/igdb-feedback\?done=submit&n=1$/);
      await expect(page.getByRole("status")).toContainText("標為已提交：1 筆");
      await expect(page.locator("article", { hasText: TITLE })).toHaveCount(0);
      await page.getByRole("link", { name: /^已提交（/ }).click();
      await expect(page).toHaveURL(/status=submitted$/);
      const sub = page.locator("article", { hasText: TITLE });
      await expect(sub).toContainText("e2e 已到 IGDB 提交");
      await expectNoA11yViolations(page, "待回饋 IGDB 清單（已提交）");
      await sub.getByRole("button", { name: "改回待回饋" }).click();
      await expect(page).toHaveURL(/status=submitted&done=reopen&n=1$/);
      await page.goto("/internal/igdb-feedback");
      await expect(page.locator("article", { hasText: TITLE })).toHaveCount(1);
    } finally {
      await ctx.close();
    }
  });

  test("批次動作：勾選兩筆略過；沒勾選會顯示錯誤；略過分頁可見", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/igdb-feedback");
      await page.getByRole("button", { name: "勾選的略過" }).click();
      await expect(page.getByRole("alert")).toContainText("請先勾選至少一筆項目");
      for (const note of SEEDS.slice(0, 2)) await page.locator("article", { hasText: note }).getByRole("checkbox").check();
      await page.getByLabel("批次處理備註（選填）").fill("e2e 批次略過");
      await page.getByRole("button", { name: "勾選的略過" }).click();
      await expect(page).toHaveURL(/\/internal\/igdb-feedback\?done=skip&n=2$/);
      for (const note of SEEDS.slice(0, 2)) await expect(page.locator("article", { hasText: note })).toHaveCount(0);
      await page.goto("/internal/igdb-feedback?status=skipped");
      for (const note of SEEDS.slice(0, 2)) await expect(page.locator("article", { hasText: note })).toContainText("e2e 批次略過");
      // 批次標已提交（第三筆）
      await page.goto("/internal/igdb-feedback");
      await page.locator("article", { hasText: SEEDS[2]! }).getByRole("checkbox").check();
      await page.getByRole("button", { name: "勾選的標為已提交" }).click();
      await expect(page).toHaveURL(/done=submit&n=1$/);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("待回饋 IGDB 存取控制", () => {
  test("未帶帳密 401、錯誤帳密 401、POST 也 401", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    try {
      const noAuth = await api.get("/internal/igdb-feedback");
      expect(noAuth.status()).toBe(401);
      expect(noAuth.headers()["www-authenticate"]).toMatch(/^Basic /);
      const wrong = await api.get("/internal/igdb-feedback", { headers: { Authorization: `Basic ${Buffer.from("e2e-admin:wrong").toString("base64")}` } });
      expect(wrong.status()).toBe(401);
      const post = await api.post("/internal/igdb-feedback/action", { form: { act: "skip:1", csrf: "x" }, headers: { Origin: baseURL! } });
      expect(post.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test("有帳密但沒有 CSRF token 或跨站 Origin → 403；格式錯誤的動作 → 400", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL, httpCredentials: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } });
    try {
      expect((await api.post("/internal/igdb-feedback/action", { form: { act: "skip:1" }, headers: { Origin: baseURL! } })).status()).toBe(403);
      expect((await api.post("/internal/igdb-feedback/action", { form: { act: "skip:1", csrf: "1.x" }, headers: { Origin: "https://evil.example" } })).status()).toBe(403);
      // 取得合法 token 後送錯誤的 act → 400
      const html = await (await api.get("/internal/igdb-feedback")).text();
      const token = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      expect(token).toBeTruthy();
      const bad = await api.post("/internal/igdb-feedback/action", { form: { act: "explode:1", csrf: token! }, headers: { Origin: baseURL! }, maxRedirects: 0 });
      expect(bad.status()).toBe(400);
    } finally {
      await api.dispose();
    }
  });
});
