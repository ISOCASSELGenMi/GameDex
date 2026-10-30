/**
 * D92 field_correction（12 §field_correction）的端到端流程與 axe。
 * 流程（serial）：公開表單選「其他資料欄位更正」→ 選欄位／動作 → 各形狀的輸入欄出現 → 欄位錯誤 → 送出成功（類型欄位、封面媒體欄位）→
 * /internal/reports 核可（目前值 → 提案值）→ /internal/igdb-feedback 清單出現卡片（欄位標籤、位置提示、新增動作、整理文字）。
 * 另測 POST /api/v1/reports 的欄位驗證錯誤（伺服器端驗證，與表單是否有 JS 無關）。
 * 測試遊戲在 beforeAll 直接寫入測試資料庫（igdbId 480002）；serial 整組重跑時 beforeAll 會清掉前一輪的回報與項目。
 */
import pg from "pg";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, testDatabaseUrl } from "./support/env";
import { expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const GAME = { igdbId: 480002, slug: "e2e-fc-game", name: "E2E Field Correction Game" };
const L: TestLocale = "zh-Hant";
const MARK = `E2eGenre${Date.now() % 1000000}`;
const COVER = `https://img.example.com/e2e-fc-${Date.now() % 1000000}.png`;

const TURNSTILE_STUB = `(function () {
  var cb = null;
  function give() { setTimeout(function () { if (cb) cb("XXXX.DUMMY.TOKEN.XXXX"); }, 0); }
  window.turnstile = { render: function (el, o) { cb = o.callback; give(); return "stub-widget"; }, reset: function () { give(); }, remove: function () {} };
})();`;

test.beforeAll(async () => {
  const c = new pg.Client({ connectionString: testDatabaseUrl() });
  await c.connect();
  try {
    await c.query("SELECT pg_advisory_lock(480002)");
    const g = await c.query(
      `INSERT INTO games (igdb_id, slug, name, game_type) VALUES ($1, $2, $3, 'main_game')
       ON CONFLICT (igdb_id) DO UPDATE SET name = excluded.name RETURNING id`,
      [GAME.igdbId, GAME.slug, GAME.name],
    );
    const gameId = g.rows[0].id;
    const genre = await c.query(
      `INSERT INTO genres (igdb_id, name, slug) VALUES (480002, 'E2E Existing Genre', 'e2e-existing-genre')
       ON CONFLICT (igdb_id) DO UPDATE SET name = excluded.name RETURNING id`,
    );
    await c.query("INSERT INTO game_genres (game_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [gameId, genre.rows[0].id]);
    // serial 失敗時整組會重跑：清掉前一輪的 field_correction 回報與它們建出的項目
    await c.query("DELETE FROM igdb_feedback_items WHERE game_id = $1 AND report_id IN (SELECT id FROM data_reports WHERE report_type = 'field_correction' AND target_id = $1)", [gameId]);
    await c.query("DELETE FROM data_reports WHERE report_type = 'field_correction' AND target_id = $1", [gameId]);
    await c.query("SELECT pg_advisory_unlock(480002)");
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
const fc = (key: string) => msg(L, `ui.report.fc.${key}`);

test.describe("其他資料欄位更正（serial）", () => {
  test.describe.configure({ mode: "serial" });

  test("公開表單：選欄位與動作 → 輸入欄依形狀出現；空值與非 http 網址顯示欄位錯誤；axe（桌機＋手機）", async ({ page }) => {
    await page.goto(`/${L}/report?game=${GAME.slug}&type=field_correction`);
    await expect(page.locator("[data-report-form]")).toBeVisible();
    await expect(page.getByText(msg(L, "ui.report.captchaLoading"))).toBeHidden();
    await expect(page.getByLabel(msg(L, "ui.report.field.type"), { exact: true })).toHaveValue("field_correction");
    await expect(page.getByText(fc("intro"))).toBeVisible();

    // 還沒選欄位送出 → 欄位錯誤（錯誤提示定位在 main 內，避開 route announcer）
    const fieldSel = page.getByLabel(fc("fieldLabel"), { exact: true });
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.locator('main p[role="alert"]')).toContainText(msg(L, "ui.report.errors.summary"));
    await expect(fieldSel).toHaveAttribute("aria-invalid", "true");
    await expectNoA11yViolations(page, "回報表單（其他資料欄位更正）");

    // 單值文字欄位：只有「修改」，選了欄位就自動帶入；顯示文字輸入
    await fieldSel.selectOption({ label: fc("field.summary") });
    await expect(page.getByLabel(fc("opLabel"), { exact: true })).toHaveValue("change");
    await expect(page.getByLabel(fc("input.text"), { exact: true })).toBeVisible();
    // 多值欄位：三種動作；名稱輸入
    await fieldSel.selectOption({ label: fc("field.genre") });
    const opSel = page.getByLabel(fc("opLabel"), { exact: true });
    await expect(opSel).toHaveValue("");
    await expect(opSel.locator("option")).toHaveText([msg(L, "ui.report.hint.choose"), fc("op.add"), fc("op.change"), fc("op.remove")]);
    await opSel.selectOption({ label: fc("op.change") });
    await expect(page.getByLabel(fc("input.name"), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(fc("oldValueLegend"))).toBeVisible(); // 修改時可指出要被取代的舊值
    await opSel.selectOption({ label: fc("op.add") });
    await expect(page.getByText(fc("oldValueLegend"))).toBeHidden();
    // 空名稱 → 欄位錯誤
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByLabel(fc("input.name"), { exact: true })).toHaveAttribute("aria-invalid", "true");

    // 媒體欄位：網址輸入＋來源說明；非 http(s) 網址由伺服器驗證擋下
    await fieldSel.selectOption({ label: fc("field.cover") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await expect(page.getByText(fc("hint.media"))).toBeVisible();
    await page.getByLabel(fc("input.url"), { exact: true }).fill("javascript:alert(1)");
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByLabel(fc("input.url"), { exact: true })).toHaveAttribute("aria-invalid", "true");
    // 年齡分級（兩個輸入）、公司（協力／移植有角色下拉）、關聯（下拉＋兩個輸入）
    await fieldSel.selectOption({ label: fc("field.company_supporting") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await expect(page.getByLabel(fc("input.role"), { exact: true })).toBeVisible();
    await fieldSel.selectOption({ label: fc("field.relation_parent") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await expect(page.getByLabel(fc("input.relation"), { exact: true })).toBeVisible();
    await expect(page.getByLabel(fc("input.gameName"), { exact: true })).toBeVisible();
    await fieldSel.selectOption({ label: fc("field.age_rating") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await expect(page.getByLabel(fc("input.organization"), { exact: true })).toBeVisible();
    await expect(page.getByLabel(fc("input.rating"), { exact: true })).toBeVisible();
    await expectNoA11yViolations(page, "回報表單（欄位已展開）");
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoA11yViolations(page, "回報表單（手機）");
  });

  test("公開表單：送出類型新增與封面新增", async ({ page }) => {
    await page.goto(`/${L}/report?game=${GAME.slug}&type=field_correction`);
    await expect(page.getByText(msg(L, "ui.report.captchaLoading"))).toBeHidden();
    await page.getByLabel(fc("fieldLabel"), { exact: true }).selectOption({ label: fc("field.genre") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await page.getByLabel(fc("input.name"), { exact: true }).fill(`  ${MARK}  `);
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByRole("status")).toContainText(msg(L, "ui.report.success.title"));

    await page.goto(`/${L}/report?game=${GAME.slug}&type=field_correction`);
    await expect(page.getByText(msg(L, "ui.report.captchaLoading"))).toBeHidden();
    await page.getByLabel(fc("fieldLabel"), { exact: true }).selectOption({ label: fc("field.cover") });
    await page.getByLabel(fc("opLabel"), { exact: true }).selectOption({ label: fc("op.add") });
    await page.getByLabel(fc("input.url"), { exact: true }).fill(COVER);
    await page.getByRole("button", { name: msg(L, "ui.report.submit") }).click();
    await expect(page.getByRole("status")).toContainText(msg(L, "ui.report.success.title"));
  });

  test("POST /api/v1/reports：欄位驗證錯誤以欄位路徑回報（伺服器端驗證）", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    try {
      const post = async (proposed: unknown) => {
        const res = await api.post("/api/v1/reports", {
          data: { reportType: "field_correction", targetType: "game", targetId: 1, proposed, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" },
          headers: { Origin: baseURL! },
        });
        return { status: res.status(), body: (await res.json()) as { error?: string; fields?: Record<string, string> } };
      };
      expect(await post({ field: "summary", op: "add", value: { text: "x" } })).toMatchObject({ status: 400, body: { error: "validation_failed", fields: { "proposed.op": "invalid" } } });
      expect(await post({ field: "external_link", op: "add", value: { url: "ftp://x.example" } })).toMatchObject({ status: 400, body: { fields: { "proposed.value.url": "invalid" } } });
      expect(await post({ field: "nope", op: "add", value: {} })).toMatchObject({ status: 400, body: { fields: { "proposed.field": "invalid" } } });
    } finally {
      await api.dispose();
    }
  });

  test("審核頁：目前值 → 提案值，核可後顯示已建立待回饋項目（不改遊戲資料）", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/reports");
      const card = page.locator("article", { hasText: MARK });
      await expect(card).toBeVisible();
      const row = card.locator("tbody tr", { hasText: "類型（新增）" });
      await expect(row).toContainText("E2E Existing Genre"); // 目前值（我方資料）
      await expect(row).toContainText(`新增：${MARK}`); // 提案值（已 trim）
      await expect(card).toContainText("不修改我方資料");
      await expectNoA11yViolations(page, "審核頁（field_correction）");
      await card.getByRole("button", { name: "核可" }).click();
      await expect(page).toHaveURL(/\/internal\/reports\?done=accept&id=\d+$/);
      // 封面那一筆也核可
      await page.goto("/internal/reports");
      await page.locator("article", { hasText: COVER }).getByRole("button", { name: "核可" }).click();
      await expect(page).toHaveURL(/\/internal\/reports\?done=accept&id=\d+$/);
      await page.goto("/internal/reports?status=accepted");
      await expect(page.locator("article", { hasText: MARK }).locator("[data-feedback-created]")).toContainText("已建立待回饋 IGDB 項目");
    } finally {
      await ctx.close();
    }
  });

  test("清單頁：新欄位卡片（欄位標籤、位置提示、新增動作、舊值、整理文字）、媒體欄位佐證＝網址、axe", async ({ browser }) => {
    const ctx = await browser.newContext({ ...adminAuth, locale: "zh-TW" });
    const page = await ctx.newPage();
    try {
      await page.goto("/internal/igdb-feedback");
      const genre = page.locator("article", { hasText: MARK });
      await expect(genre).toContainText("類型");
      await expect(genre).toContainText("遊戲頁 → Edit → Genres（推測，待對照 IGDB 編輯頁）");
      await expect(genre).toContainText("E2E Existing Genre"); // 核可當下我方資料的快照
      await expect(genre).toContainText(`新增：${MARK}`);
      const paste = genre.getByLabel(/可貼到 IGDB 的整理文字/);
      await expect(paste).toHaveAttribute("readonly", "");
      await expect(paste).toHaveValue(new RegExp(`動作：新增[\\s\\S]*要新增的值：${MARK}`));
      const cover = page.locator("article", { hasText: COVER }).first();
      await expect(cover).toContainText("封面圖");
      await expect(cover.getByRole("link", { name: COVER })).toBeVisible(); // 佐證連結＝值的網址
      await expectNoA11yViolations(page, "待回饋 IGDB 清單（field_correction）");
      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoA11yViolations(page, "待回饋 IGDB 清單（field_correction，手機）");
    } finally {
      await ctx.close();
    }
  });
});
