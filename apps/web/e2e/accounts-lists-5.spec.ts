/**
 * Phase 7 第 5 波畫面：詳情頁動作列（加入清單、記錄遊玩）、玩家平均、帳號子頁（清單、清單內容、遊玩紀錄）、
 * 公開清單頁、Steam 遊戲庫手動指定。登入用 API（快）；資料用 API 或直接寫測試資料庫。
 */
import { E2E_BASE_URL } from "./support/env";
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, gameUrl, msg, test, type TestLocale } from "./support/helpers";
import { api, gameIdBySlug, horizontalOverflow, seedManualSteam, seedPlayerRating, signedInUser } from "./support/accounts";
import type { Page } from "@playwright/test";

const m = (locale: TestLocale, key: string, values?: Record<string, string | number>) => msg(locale, `accounts.${key}`, values);

interface ListRes {
  list: { id: number; shareToken: string | null; visibility: string };
}

async function makeList(page: Page, name: string, visibility: "public" | "unlisted" | "private" = "private", gameSlugs: string[] = []): Promise<ListRes["list"]> {
  const created = await api<ListRes>(page, "POST", "/api/v1/lists", { name, visibility });
  expect(created.status).toBe(201);
  for (const slug of gameSlugs) {
    const r = await api(page, "POST", `/api/v1/lists/${created.json.list.id}/games/${await gameIdBySlug(slug)}`);
    expect([200, 201]).toContain(r.status);
  }
  return created.json.list;
}

async function makeRecord(page: Page, slug: string, body: Record<string, unknown>): Promise<number> {
  const r = await api<{ record: { id: number } }>(page, "POST", "/api/v1/play-records", { gameId: await gameIdBySlug(slug), ...body });
  expect(r.status).toBe(201);
  return r.json.record.id;
}

test.describe("詳情頁動作列：未登入", () => {
  for (const locale of LOCALES) {
    test(`${locale} 兩個按鈕都在、說明「不是追蹤」；按下導到登入頁並帶回跳路徑`, async ({ page }) => {
      await page.goto(gameUrl(locale, FIXTURE.hero.slug));
      const add = page.getByRole("button", { name: m(locale, "game.addToList"), exact: true });
      const log = page.getByRole("button", { name: m(locale, "game.logPlay"), exact: true });
      await expect(add).toBeEnabled(); // session 取得後才啟用（匿名）
      await expect(log).toBeEnabled();
      await expect(page.getByText(m(locale, "game.notTracking"))).toBeVisible();
      await add.click();
      await page.waitForURL(`**/${locale}/login?next=*`);
      expect(new URL(page.url()).searchParams.get("next")).toBe(gameUrl(locale, FIXTURE.hero.slug));
      await page.goBack();
      await expect(log).toBeEnabled();
      await log.click();
      await page.waitForURL(`**/${locale}/login?next=*`);
    });
  }

  test("詳情頁 HTML 與使用者無關：登入後回應仍無 Set-Cookie、不含使用者名稱；按鈕外殼在伺服器 HTML 內", async ({ page, request }) => {
    const name = "快取檢查員W5";
    await signedInUser(page, "cache", name);
    const url = gameUrl("zh-Hant", FIXTURE.hero.slug);
    const authed = await page.request.get(url);
    const anon = await request.get(url);
    expect(authed.headers()["set-cookie"]).toBeUndefined();
    expect(authed.headers()["cache-control"]).toBe(anon.headers()["cache-control"]);
    const html = await authed.text();
    expect(html).not.toContain(name);
    expect(html).toContain('data-game-actions="loading"');
    expect(html).toContain(m("zh-Hant", "game.addToList"));
  });
});

test.describe("詳情頁動作列：已登入", () => {
  test("加入清單：新建清單並加入、取消勾選、再勾選、Esc 關閉後焦點回到按鈕", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "picker");
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    const add = page.getByRole("button", { name: m(locale, "game.addToList"), exact: true });
    await expect(add).toBeEnabled();
    await add.click();
    const dlg = page.getByRole("dialog", { name: m(locale, "game.addToList") });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText(m(locale, "list.pickerEmpty"))).toBeVisible();
    // 名稱空白：欄位錯誤
    await dlg.getByRole("button", { name: m(locale, "list.createAndAdd") }).click();
    await expect(dlg.getByText(m(locale, "error.field.required"))).toBeVisible();
    await dlg.getByLabel(m(locale, "list.field.name")).fill("E2E 清單");
    await dlg.getByRole("button", { name: m(locale, "list.createAndAdd") }).click();
    const status = dlg.getByRole("status");
    await expect(status).toContainText(m(locale, "list.createdAndAdded", { name: "E2E 清單" }));
    const box = dlg.getByRole("checkbox", { name: /E2E 清單/ });
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(status).toContainText(m(locale, "list.removed", { name: "E2E 清單" }));
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(status).toContainText(m(locale, "list.added", { name: "E2E 清單" }));
    await expectNoA11yViolations(page, "詳情頁 加入清單對話框");
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(add).toBeFocused();
    await expect(page.getByTestId("game-actions-summary")).toContainText(m(locale, "game.inLists", { count: 1 }));
    // 後端狀態一致
    const state = await api<{ lists: { name: string; contains: boolean }[] }>(page, "GET", `/api/v1/me/games/${await gameIdBySlug(FIXTURE.hero.slug)}`);
    expect(state.json.lists).toEqual([expect.objectContaining({ name: "E2E 清單", contains: true })]);
  });

  test("記錄遊玩：日期先後錯誤、伺服器欄位錯誤對應文案、新增、編輯、刪除", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "play");
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    const log = page.getByRole("button", { name: m(locale, "game.logPlay"), exact: true });
    await expect(log).toBeEnabled();
    await log.click();
    const dlg = page.getByRole("dialog", { name: m(locale, "game.logPlay") });
    await expect(dlg.getByLabel(m(locale, "play.field.status"))).toHaveValue("playing");
    await expect(dlg.getByText(m(locale, "play.field.privateNote"))).toBeVisible();
    await expect(dlg.getByText(m(locale, "play.privateNoteHint", { limit: "5000" }))).toBeVisible();

    // 完成日早於開始日（客戶端檢查）
    await dlg.getByLabel(m(locale, "play.field.startedOn")).fill("2030-05-10");
    await dlg.getByLabel(m(locale, "play.field.finishedOn")).fill("2030-05-01");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(dlg.getByRole("alert").first()).toHaveText(m(locale, "error.summary"));
    await expect(dlg.getByText(m(locale, "error.field.before_started_on"))).toBeVisible();
    await expect(dlg.getByLabel(m(locale, "play.field.finishedOn"))).toHaveAttribute("aria-invalid", "true");
    // 耗時不是數字
    await dlg.getByLabel(m(locale, "play.field.finishedOn")).fill("2030-05-20");
    await dlg.getByLabel(m(locale, "play.field.hours"), { exact: true }).fill("abc");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(dlg.getByText(m(locale, "error.field.invalid"))).toBeVisible();

    // 伺服器回 validation_failed：欄位對應到文案
    await page.route("**/api/v1/play-records", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "validation_failed", fields: { ratingHalfSteps: "out_of_range", platformId: "not_in_game" } }) })
        : route.fallback(),
    );
    await dlg.getByLabel(m(locale, "play.field.hours"), { exact: true }).fill("12");
    await dlg.getByLabel(m(locale, "play.field.minutes"), { exact: true }).fill("30");
    await dlg.getByLabel(m(locale, "play.field.rating"), { exact: true }).selectOption("17");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(dlg.getByText(m(locale, "error.field.out_of_range"))).toBeVisible();
    await expect(dlg.getByText(m(locale, "error.field.not_in_game"))).toBeVisible();
    await page.unroute("**/api/v1/play-records");

    // 成功新增
    await dlg.getByLabel(m(locale, "play.field.review"), { exact: true }).fill("很好玩");
    await dlg.getByLabel(m(locale, "play.field.privateNote"), { exact: true }).fill("只有我看得到");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(dlg.getByRole("status")).toContainText(m(locale, "play.created"));
    const row = dlg.getByRole("list", { name: m(locale, "play.listLabel") }).getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(m(locale, "play.status.playing"));
    await expect(row).toContainText("12 小時 30 分");
    await expect(row).toContainText(m(locale, "play.ratingValue", { rating: "8.5" }));
    await expectNoA11yViolations(page, "詳情頁 遊玩紀錄對話框（列表）");

    // 編輯：改成「玩完」
    await dlg.getByRole("button", { name: `${m(locale, "play.edit")} ${m(locale, "play.status.playing")}` }).click();
    await expect(dlg.getByLabel(m(locale, "play.field.privateNote"), { exact: true })).toHaveValue("只有我看得到");
    await expectNoA11yViolations(page, "詳情頁 遊玩紀錄對話框（表單）");
    await dlg.getByLabel(m(locale, "play.field.status")).selectOption("finished");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(dlg.getByRole("status")).toContainText(m(locale, "play.updated"));
    await expect(row).toContainText(m(locale, "play.status.finished"));

    // 刪除（需確認）
    await dlg.getByRole("button", { name: `${m(locale, "play.delete")} ${m(locale, "play.status.finished")}` }).click();
    await expect(dlg.getByText(m(locale, "play.confirmDelete"))).toBeVisible();
    await dlg.getByRole("button", { name: `${m(locale, "common.confirmDelete")} ${m(locale, "play.status.finished")}` }).click();
    await expect(dlg.getByRole("status")).toContainText(m(locale, "play.deleted"));
    await expect(row).toHaveCount(0);
  });

  test("已有紀錄時對話框先列出紀錄；320 寬無水平溢出", async ({ page }) => {
    const locale: TestLocale = "ja";
    await signedInUser(page, "narrow");
    await makeRecord(page, FIXTURE.hero.slug, { status: "completed", ratingHalfSteps: 20, playMinutes: 90 });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(gameUrl(locale, FIXTURE.hero.slug));
    await page.getByRole("button", { name: m(locale, "game.logPlay"), exact: true }).click();
    const dlg = page.getByRole("dialog", { name: m(locale, "game.logPlay") });
    await expect(dlg.getByRole("list", { name: m(locale, "play.listLabel") })).toContainText("1 時間 30 分");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await dlg.getByRole("button", { name: m(locale, "play.addAnother") }).click();
    await expect(dlg.getByLabel(m(locale, "play.field.status"))).toBeVisible();
    const box = await dlg.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await expectNoA11yViolations(page, "ja 詳情頁 記錄遊玩 320");
  });
});

test.describe("玩家平均（詳情頁 game.sections）", () => {
  test("達門檻顯示平均與人數與平均耗時；未達門檻只顯示說明；沒資料整區不顯示", async ({ page }) => {
    await seedPlayerRating(FIXTURE.hero.slug, { ratingCount: 123, avgHalfSteps: 17, avgPlayMinutes: 750 });
    await seedPlayerRating(FIXTURE.monthPrecision.slug, { ratingCount: 3, avgHalfSteps: 15, avgPlayMinutes: null });
    for (const locale of LOCALES) {
      await page.goto(gameUrl(locale, FIXTURE.hero.slug));
      const sec = page.locator("[data-player-rating]");
      await expect(sec.getByRole("heading", { level: 2, name: m(locale, "playerRating.title") })).toBeVisible();
      await expect(sec.getByTestId("player-rating-avg")).toHaveText(m(locale, "playerRating.avg", { avg: "8.5", scale: 10, count: 123 }));
      await expect(sec.getByTestId("player-rating-time")).toContainText(locale === "zh-Hant" ? "12 小時 30 分" : locale === "en" ? "12 h 30 min" : "12 時間 30 分");
      await expectNoA11yViolations(page, `${locale} 玩家平均`);
    }
    await page.goto(gameUrl("zh-Hant", FIXTURE.monthPrecision.slug));
    await expect(page.getByText(m("zh-Hant", "playerRating.notEnough"))).toBeVisible();
    await expect(page.getByTestId("player-rating-avg")).toHaveCount(0);
    // 只檢查玩家平均區本身（整頁 HTML 的 flight 資料會碰巧含有 "123"）
    expect(await page.locator("[data-player-rating]").innerText()).not.toContain("123");
    const none = page.waitForResponse((r) => r.url().includes("/api/v1/player-ratings/"));
    await page.goto(gameUrl("zh-Hant", "e2e-aurora-prequel"));
    await none;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("[data-player-rating]")).toHaveCount(0);
  });

  test("API：公開、可快取、不送 Set-Cookie", async ({ request }) => {
    const id = await gameIdBySlug(FIXTURE.hero.slug);
    const res = await request.get(`/api/v1/player-ratings/${id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(res.headers()["cache-control"]).toContain("s-maxage");
  });
});

test.describe("帳號子頁", () => {
  test("未登入：三個子頁都顯示登入提示（帶回跳路徑）", async ({ page }) => {
    const locale: TestLocale = "en";
    for (const p of ["account/lists", "account/lists/1", "account/plays"]) {
      await page.goto(`/${locale}/${p}`);
      await expect(page.getByRole("heading", { name: m(locale, "account.signedOutTitle") })).toBeVisible();
      await expect(page.getByRole("link", { name: m(locale, "account.signIn") })).toHaveAttribute("href", new RegExp(`/${locale}/login\\?next=`));
    }
    const res = await page.request.get(`/${locale}/account/lists`);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
  });

  for (const locale of LOCALES) {
    for (const width of [1280, 320]) {
      test(`${locale} 清單／清單內容／遊玩紀錄 axe 無違規、無水平溢出（寬 ${width}）`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await signedInUser(page, `axe-${locale}-${width}`);
        const pub = await makeList(page, "A very long list name that keeps going and going to test wrapping at narrow widths", "public", [FIXTURE.hero.slug, FIXTURE.monthPrecision.slug]);
        await makeList(page, "Secret picks", "unlisted", [FIXTURE.hero.slug]);
        await makeRecord(page, FIXTURE.hero.slug, { status: "finished", ratingHalfSteps: 17, playMinutes: 750, finishedOn: new Date().toISOString().slice(0, 10), review: "ok" });
        await makeRecord(page, FIXTURE.monthPrecision.slug, { status: "want_to_play" });

        await page.goto(`/${locale}/account`);
        await expect(page.getByRole("link", { name: m(locale, "account.tab.lists"), exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: m(locale, "account.tab.plays"), exact: true })).toBeVisible();
        expect(await horizontalOverflow(page), "account").toBeLessThanOrEqual(0);

        await page.goto(`/${locale}/account/lists`);
        await expect(page.getByRole("list", { name: m(locale, "list.listLabel") }).getByRole("listitem")).toHaveCount(2);
        // unlisted 的分享網址在清單上
        await expect(page.getByLabel(m(locale, "list.shareUrl"))).toHaveValue(/\/lists\/s\//);
        expect(await horizontalOverflow(page), "lists").toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} /account/lists ${width}`);

        await page.goto(`/${locale}/account/lists/${pub.id}`);
        await expect(page.getByTestId("list-name")).toBeVisible();
        await expect(page.getByRole("list", { name: m(locale, "list.gamesLabel") }).getByRole("listitem")).toHaveCount(2);
        expect(await horizontalOverflow(page), "list detail").toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} /account/lists/id ${width}`);

        await page.goto(`/${locale}/account/plays`);
        await expect(page.getByTestId("play-stats")).toBeVisible();
        await expect(page.getByRole("list", { name: m(locale, "play.listLabel") }).getByRole("listitem")).toHaveCount(2);
        expect(await horizontalOverflow(page), "plays").toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} /account/plays ${width}`);
      });
    }
  }

  test("我的清單：建立、改名與改可見度（unlisted 出現分享網址）、重新產生網址、上下移動、刪除需確認", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "lists");
    await page.goto(`/${locale}/account/lists`);
    await expect(page.getByText(m(locale, "list.empty"))).toBeVisible();
    for (const name of ["第一份", "第二份"]) {
      await page.getByLabel(m(locale, "list.field.name"), { exact: true }).first().fill(name);
      await page.getByRole("button", { name: m(locale, "list.create"), exact: true }).click();
      await expect(page.getByRole("status")).toContainText(m(locale, "list.created", { name }));
    }
    const items = page.getByRole("list", { name: m(locale, "list.listLabel") }).getByRole("listitem");
    await expect(items.nth(0)).toContainText("第一份");
    // 預設私人
    await expect(items.nth(0)).toContainText(m(locale, "list.visibility.private"));
    // 上下移動
    await page.getByRole("button", { name: `${m(locale, "list.moveUp")} 第二份` }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.moved", { name: "第二份", position: 1 }));
    await expect(items.nth(0)).toContainText("第二份");
    // 改名＋改成不公開
    await page.getByRole("button", { name: `${m(locale, "list.edit")} 第一份` }).click();
    await page.getByLabel(m(locale, "list.field.name"), { exact: true }).last().fill("第一份改名");
    await page.getByLabel(m(locale, "list.field.visibility")).last().selectOption("unlisted");
    await page.getByRole("button", { name: m(locale, "list.save"), exact: true }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.saved", { name: "第一份改名" }));
    const share = page.getByLabel(m(locale, "list.shareUrl"));
    await expect(share).toHaveValue(/\/zh-Hant\/lists\/s\/[A-Za-z0-9_-]{8,}/);
    const before = await share.inputValue();
    // 重新產生網址
    await page.getByRole("button", { name: `${m(locale, "list.rotate")} 第一份改名` }).click();
    await page.getByRole("button", { name: `${m(locale, "list.confirmRotateButton")} 第一份改名` }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.rotated", { name: "第一份改名" }));
    await expect(share).not.toHaveValue(before);
    // 舊網址失效
    const old = await page.request.get(before.replace(/^https?:\/\/[^/]+/, ""));
    expect(await old.text()).toContain(msg(locale, "errors.notFound.title"));
    // 刪除需確認
    await page.getByRole("button", { name: `${m(locale, "list.delete")} 第二份` }).click();
    await expect(page.getByText(m(locale, "list.confirmDelete", { name: "第二份" }))).toBeVisible();
    await page.getByRole("button", { name: `${m(locale, "common.confirmDelete")} 第二份` }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.deleted", { name: "第二份" }));
    await expect(items).toHaveCount(1);
  });

  test("清單內容：加註、上下移動、移出需確認", async ({ page }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "detail");
    const list = await makeList(page, "Detail list", "private", [FIXTURE.hero.slug, FIXTURE.monthPrecision.slug]);
    await page.goto(`/${locale}/account/lists/${list.id}`);
    const items = page.getByRole("list", { name: m(locale, "list.gamesLabel") }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(FIXTURE.hero.name);
    await page.getByRole("button", { name: `${m(locale, "list.noteAdd")} ${FIXTURE.hero.name}` }).click();
    await page.getByLabel(m(locale, "list.noteLabel", { name: FIXTURE.hero.name })).fill("replay in winter");
    await page.getByRole("button", { name: m(locale, "list.save"), exact: true }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.noteSaved", { name: FIXTURE.hero.name }));
    await expect(items.nth(0)).toContainText("replay in winter");
    await page.getByRole("button", { name: `${m(locale, "list.moveDown")} ${FIXTURE.hero.name}` }).click();
    await expect(items.nth(1)).toContainText(FIXTURE.hero.name);
    await expect(items.nth(1)).toContainText("replay in winter");
    await page.reload();
    await expect(items.nth(1)).toContainText(FIXTURE.hero.name);
    await page.getByRole("button", { name: `${m(locale, "list.gameRemove")} ${FIXTURE.hero.name}` }).click();
    await page.getByRole("button", { name: `${m(locale, "common.confirmDelete")} ${FIXTURE.hero.name}` }).click();
    await expect(page.getByRole("status")).toContainText(m(locale, "list.gameRemoved", { name: FIXTURE.hero.name }));
    await expect(items).toHaveCount(1);
  });

  test("遊玩紀錄頁：統計、編輯（共用表單）、刪除、統計同步", async ({ page }) => {
    const locale: TestLocale = "zh-Hant";
    await signedInUser(page, "plays");
    const today = new Date().toISOString().slice(0, 10);
    await makeRecord(page, FIXTURE.hero.slug, { status: "finished", playMinutes: 150, finishedOn: today });
    await makeRecord(page, FIXTURE.monthPrecision.slug, { status: "playing", playMinutes: 30 });
    await page.goto(`/${locale}/account/plays`);
    const stats = page.getByTestId("play-stats");
    await expect(stats.locator('[data-stat="finished"]')).toHaveText("1");
    await expect(stats.locator('[data-stat="playing"]')).toHaveText("1");
    await expect(stats.locator('[data-stat="finishedThisYear"]')).toHaveText("1");
    await expect(stats.locator('[data-stat="totalTime"]')).toHaveText("3 小時");
    // 編輯：改成放棄
    const first = page.locator("[data-record-id]").filter({ hasText: m(locale, "play.status.playing") });
    await first.getByRole("button", { name: `${m(locale, "play.edit")} ${m(locale, "play.status.playing")}` }).click();
    const dlg = page.getByRole("dialog", { name: m(locale, "play.editTitle") });
    await expect(dlg.getByLabel(m(locale, "play.field.status"))).toHaveValue("playing");
    await expectNoA11yViolations(page, "plays 編輯對話框");
    await dlg.getByLabel(m(locale, "play.field.status")).selectOption("abandoned");
    await dlg.getByRole("button", { name: m(locale, "play.save") }).click();
    await expect(page.getByRole("status").first()).toContainText(m(locale, "play.updated"));
    await expect(stats.locator('[data-stat="abandoned"]')).toHaveText("1");
    await expect(stats.locator('[data-stat="playing"]')).toHaveText("0");
    // 刪除
    const done = page.locator("[data-record-id]").filter({ hasText: m(locale, "play.status.finished") });
    await done.getByRole("button", { name: `${m(locale, "play.delete")} ${m(locale, "play.status.finished")}` }).click();
    await done.getByRole("button", { name: `${m(locale, "common.confirmDelete")} ${m(locale, "play.status.finished")}` }).click();
    await expect(page.locator("[data-record-id]")).toHaveCount(1);
    await expect(stats.locator('[data-stat="finished"]')).toHaveText("0");
  });
});

test.describe("公開清單頁", () => {
  test("public：匿名可見、可索引、無 Set-Cookie、HTML 無檢視者資訊；擁有者提示只在客戶端出現", async ({ page, request, browser }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "public", "Public Owner");
    const list = await makeList(page, "Public picks", "public", [FIXTURE.hero.slug]);
    const url = `/${locale}/lists/${list.id}`;

    const anon = await request.get(url);
    expect(anon.status()).toBe(200);
    expect(anon.headers()["set-cookie"]).toBeUndefined();
    const html = await anon.text();
    expect(html).toContain("Public picks");
    expect(html).toContain(FIXTURE.hero.name);
    expect(html).toContain("Public Owner");
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
    expect(html).not.toContain(email);
    expect(html).not.toContain("data-owner-hint"); // 提示元件只在客戶端確認擁有者後才渲染（字串常數會出現在 RSC payload，所以看渲染標記）
    // 帶登入 Cookie 的請求：回應同樣不含擁有者資訊、不送 Set-Cookie
    const authed = await page.request.get(url);
    expect(authed.headers()["set-cookie"]).toBeUndefined();
    expect(await authed.text()).not.toContain("data-owner-hint");

    // 匿名瀏覽
    const ctx = await browser.newContext({ baseURL: E2E_BASE_URL });
    const anonPage = await ctx.newPage();
    await anonPage.goto(url);
    await expect(anonPage.getByRole("heading", { level: 1, name: "Public picks" })).toBeVisible();
    await expect(anonPage.getByRole("link", { name: FIXTURE.hero.name })).toHaveAttribute("href", `/${locale}/games/${FIXTURE.hero.slug}`);
    await expect(anonPage.getByText(m(locale, "list.public.ownerHint"))).toHaveCount(0);
    await expectNoA11yViolations(anonPage, "公開清單頁（匿名）");
    await anonPage.setViewportSize({ width: 320, height: 800 });
    expect(await horizontalOverflow(anonPage)).toBeLessThanOrEqual(0);
    await ctx.close();

    // 擁有者
    await page.goto(url);
    await expect(page.getByText(m(locale, "list.public.ownerHint"))).toBeVisible();
    await expect(page.getByRole("link", { name: m(locale, "list.public.edit") })).toHaveAttribute("href", `/${locale}/account/lists/${list.id}`);
  });

  test("private 與不存在 → 找不到頁（noindex）；unlisted 只能用分享網址、noindex；改回 private 後舊網址失效", async ({ page, request }) => {
    const locale: TestLocale = "en";
    await signedInUser(page, "visibility");
    const priv = await makeList(page, "Private picks", "private", [FIXTURE.hero.slug]);
    const unl = await makeList(page, "Unlisted picks", "unlisted", [FIXTURE.hero.slug]);
    const notFound = msg(locale, "errors.notFound.title");

    for (const u of [`/${locale}/lists/${priv.id}`, `/${locale}/lists/999999999`, `/${locale}/lists/abc`, `/${locale}/lists/${unl.id}`, `/${locale}/lists/s/not-a-real-token-123456`]) {
      const res = await request.get(u);
      const body = await res.text();
      expect(body, u).toContain(notFound);
      expect(body, u).not.toContain("Private picks");
      expect(body, u).not.toContain("Unlisted picks");
      expect(body, u).toMatch(/<meta name="robots" content="noindex/);
      expect(res.headers()["set-cookie"], u).toBeUndefined();
    }

    const token = unl.shareToken!;
    const shared = await request.get(`/${locale}/lists/s/${token}`);
    const html = await shared.text();
    expect(html).toContain("Unlisted picks");
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    expect(html).toContain(m(locale, "list.public.unlistedNote"));
    expect(shared.headers()["set-cookie"]).toBeUndefined();

    const back = await api(page, "PATCH", `/api/v1/lists/${unl.id}`, { visibility: "private" });
    expect(back.status).toBe(200);
    const gone = await request.get(`/${locale}/lists/s/${token}`);
    expect(await gone.text()).toContain(notFound);
  });
});

test.describe("Steam 遊戲庫：手動指定", () => {
  test("篩選、候選與搜尋、指定、更正、否決、交給自動比對；axe 與 320 寬", async ({ page }) => {
    const locale: TestLocale = "en";
    const email = await signedInUser(page, "steam-match");
    await seedManualSteam(email, FIXTURE.hero.slug);
    await page.goto(`/${locale}/account/steam`);
    const summary = page.getByTestId("steam-summary");
    await expect(summary).toContainText(m(locale, "steam.summary", { total: 4, matched: 1, review: 2, notFound: 1 }));
    const list = page.getByRole("list", { name: m(locale, "steam.listLabel") });
    await expect(list.getByRole("listitem")).toHaveCount(4);

    // 篩選：待確認（伺服器端）
    await page.getByLabel(m(locale, "steam.filter.label"), { exact: true }).selectOption("needs_review");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).not.toContainText("Already Matched Game");
    await page.getByLabel(m(locale, "steam.filter.label"), { exact: true }).selectOption("all");
    await expect(list.getByRole("listitem")).toHaveCount(4);

    // 開啟對話框：沒有信心高的候選時也要能自己搜尋
    await page.getByRole("button", { name: `${m(locale, "steam.match.open.other")} Zzz Unknown Soundtrack` }).click();
    const dlg = page.getByRole("dialog", { name: m(locale, "steam.match.title") });
    await expect(dlg.getByText("Zzz Unknown Soundtrack")).toBeVisible();
    await expect(dlg.getByRole("heading", { name: m(locale, "steam.match.candidates") })).toBeVisible();
    await dlg.getByLabel(m(locale, "steam.match.searchLabel")).fill("a");
    await dlg.getByRole("button", { name: m(locale, "steam.match.searchButton") }).click();
    await expect(dlg.getByText(m(locale, "steam.match.queryTooShort"))).toBeVisible();
    await dlg.getByLabel(m(locale, "steam.match.searchLabel")).fill("Aurora");
    await dlg.getByRole("button", { name: m(locale, "steam.match.searchButton") }).click();
    const results = dlg.getByRole("list", { name: m(locale, "steam.match.searchResults") });
    await expect(results).toContainText(FIXTURE.hero.name);
    await expectNoA11yViolations(page, "steam 手動指定對話框");
    await page.setViewportSize({ width: 320, height: 800 });
    const box = await dlg.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolations(page, "steam 手動指定對話框 320");
    await page.setViewportSize({ width: 1280, height: 900 });

    // 選定
    await results.getByRole("button", { name: `${m(locale, "steam.match.choose")} ${FIXTURE.hero.name}`, exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "steam.match.done.assigned", { title: "Zzz Unknown Soundtrack", name: FIXTURE.hero.name }) })).toBeVisible();
    await expect(summary).toContainText(m(locale, "steam.summary", { total: 4, matched: 2, review: 1, notFound: 1 }));
    const row = list.getByRole("listitem").filter({ hasText: "Zzz Unknown Soundtrack" });
    await expect(row.getByRole("link", { name: FIXTURE.hero.name })).toBeVisible();

    // 更正：這不是任何遊戲
    await row.getByRole("button", { name: `${m(locale, "steam.match.open.matched")} Zzz Unknown Soundtrack` }).click();
    await dlg.getByRole("button", { name: m(locale, "steam.match.dismiss") }).click();
    await expect(dlg).toBeHidden();
    await expect(summary).toContainText(m(locale, "steam.summaryDismissed", { dismissed: 1 }));
    await expect(row).toContainText(m(locale, "steam.status.dismissed"));
    await page.getByLabel(m(locale, "steam.filter.label"), { exact: true }).selectOption("dismissed");
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // 交給自動比對：回到比對佇列／重新比對，不再是「已否決」
    await list.getByRole("button", { name: `${m(locale, "steam.match.open.other")} Zzz Unknown Soundtrack` }).click();
    await dlg.getByRole("button", { name: m(locale, "steam.match.reset") }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: m(locale, "steam.match.done.reset", { title: "Zzz Unknown Soundtrack" }) })).toBeVisible();
    await expect(page.getByText(m(locale, "steam.emptyFiltered"))).toBeVisible();
  });

  test("API：匿名 PATCH 手動指定 → 401", async ({ request }) => {
    const res = await request.patch("/api/v1/imports/steam/games/1", { headers: { origin: E2E_BASE_URL }, data: { reset: true } });
    expect(res.status()).toBe(401);
  });
});
