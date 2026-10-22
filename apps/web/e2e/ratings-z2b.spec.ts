/**
 * GameDex 第 2 輪（Z2B）：評分排名頁 /ratings（e2e＋axe）。
 * 資料：時間軸 fixture 的遊戲掛上 IGDB 分數與站內玩家平均（見 support/seed-z2b.ts）。
 * IGDB 預設門檻 10 → 66 款（含既有 fixture 的 hero，超過一頁）；玩家平均預設門檻 5 → 5 款。
 */
import { expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";
import { openMainNav } from "./support/helpers";
import { FIXTURE_Z2B as F, fillerScore } from "./support/fixture-z2b";
import type { Page } from "@playwright/test";

const url = (q = "", locale: TestLocale = "zh-Hant") => `/${locale}/ratings${q ? `?${q}` : ""}`;
const rows = (page: Page) => page.locator("[data-rk-row]");
const slugs = (page: Page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-rk-row")));
const th = (page: Page, sort: string) => page.locator(`th:has(button[data-sort="${sort}"])`);
const sortBtn = (page: Page, sort: string) => page.locator(`button[data-sort="${sort}"]`);
const ready = async (page: Page) => {
  await expect(rows(page).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
};

/** 記錄所有 Element.animate 呼叫（FLIP 規格檢查用）。 */
async function recordAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __anims: Array<{ tag: string; props: string[]; duration: number; easing: string; from: string | null }> };
    w.__anims = [];
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) {
      try {
        const frames = (Array.isArray(kf) ? kf : []) as Keyframe[];
        const props = new Set<string>();
        for (const f of frames) for (const k of Object.keys(f)) if (k !== "offset" && k !== "easing" && k !== "composite") props.add(k);
        const o = typeof opts === "number" ? { duration: opts } : (opts ?? {});
        w.__anims.push({
          tag: this.tagName,
          props: [...props].sort(),
          duration: Number(o.duration ?? 0),
          easing: String(o.easing ?? "linear"),
          from: frames[0] && typeof frames[0].transform === "string" ? frames[0].transform : null,
        });
      } catch {
        /* 記錄失敗不影響頁面 */
      }
      return orig.call(this, kf as Keyframe[], opts);
    } as typeof Element.prototype.animate;
  });
}
const trAnims = (page: Page) =>
  page.evaluate(() => (window as unknown as { __anims: Array<{ tag: string; props: string[]; duration: number; easing: string; from: string | null }> }).__anims.filter((a) => a.tag === "TR"));

test.describe("評分排名頁：版面與內容", () => {
  test("表格結構、欄位、預設排序（IGDB 分數降冪）、名次（同分同名次）、分數與人數", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg("zh-Hant", "ui.ratings.title"));
    const table = page.getByRole("table", { name: msg("zh-Hant", "ui.ratings.caption") });
    await expect(table).toBeVisible();
    // 排序欄標題後面有 aria-hidden 的箭頭（▼），所以用名稱比對而不是整段文字
    const heads = table.getByRole("columnheader");
    await expect(heads).toHaveCount(4);
    await expect(heads.nth(0)).toHaveText(msg("zh-Hant", "ui.ratings.rank"));
    await expect(heads.nth(1)).toHaveText(msg("zh-Hant", "ui.ratings.game"));
    await expect(heads.nth(2)).toHaveAccessibleName(msg("zh-Hant", "ui.ratings.col.igdb"));
    await expect(heads.nth(3)).toHaveAccessibleName(msg("zh-Hant", "ui.ratings.col.players"));
    await expect(table.getByRole("button", { name: msg("zh-Hant", "ui.ratings.col.igdb") })).toBeVisible();
    // 可排序欄位的標題是 <button>；排序欄的 <th> 有 aria-sort，其他欄沒有
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    await expect(th(page, "players")).not.toHaveAttribute("aria-sort", /.+/);
    expect(await slugs(page)).toHaveLength(50);
    expect((await slugs(page)).slice(0, 5)).toEqual(["e2e-big-01", "e2e-big-02", "e2e-big-03", "e2e-big-04", "e2e-aurora-odyssey"]);
    // 名次：分數最高＝1，同分同名次（02 與 03 都是 90 分 → 都是第 2 名）；第 5 是 hero（82 分）、第 6 是 big-06（70 分）
    const rankTexts = await page.locator("[data-rk-row] .rk-rank-n").evaluateAll((els) => els.slice(0, 6).map((e) => e.textContent));
    expect(rankTexts).toEqual(["1", "2", "2", "4", "5", "6"]);
    const first = rows(page).first();
    await expect(first.locator('td[data-col="igdb"] .rk-score')).toHaveText("95");
    await expect(first.locator('td[data-col="igdb"] .rk-count')).toHaveText(msg("zh-Hant", "ui.ratings.count.critics", { count: 50 }));
    await expect(first.locator('td[data-col="players"] .rk-score')).toHaveText("8.0");
    await expect(first.locator('td[data-col="players"] .rk-count')).toHaveText(msg("zh-Hant", "ui.ratings.count.players", { count: 8 }));
    // 沒有玩家平均的列：視覺「—」＋螢幕閱讀器「尚無評分」
    const second = rows(page).nth(1);
    await expect(second.locator('td[data-col="players"]')).toContainText("—");
    await expect(second.locator('td[data-col="players"] .sr-only')).toHaveText(msg("zh-Hant", "ui.ratings.noScore"));
    // 遊戲欄：封面、名稱、年份，連到詳情頁；遊戲欄是列標題
    await expect(first.locator("th[scope='row'] a")).toHaveAttribute("href", "/zh-Hant/games/e2e-big-01");
    // 年份：時間軸 fixture 的遊戲沒有首發日期（不顯示年份）；hero 是 2036
    await expect(first.locator(".rk-year")).toHaveCount(0);
    await expect(page.locator('[data-rk-row="e2e-aurora-odyssey"] .rk-year')).toHaveText("2036");
    await expect(page.locator("[data-rk-status]")).toHaveText(msg("zh-Hant", "ui.ratings.status", { total: F.eligibleDefault, column: msg("zh-Hant", "ui.ratings.col.igdb"), direction: msg("zh-Hant", "ui.ratings.dirDesc") }));
  });

  test("英文與日文：標題、欄位名、狀態宣告的方向文字", async ({ page }) => {
    for (const locale of ["en", "ja"] as const) {
      await page.goto(url("sort=players&dir=asc", locale));
      await ready(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg(locale, "ui.ratings.title"));
      await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
      await expect(page.locator("[data-rk-status]")).toHaveText(
        msg(locale, "ui.ratings.status", { total: F.playersEligible, column: msg(locale, "ui.ratings.col.players"), direction: msg(locale, "ui.ratings.dirAsc") }),
      );
    }
  });

  test("header 導覽下拉有「評分排名」，且在該頁標示為目前頁", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    const nav = await openMainNav(page, "zh-Hant");
    const link = nav.getByRole("link", { name: msg("zh-Hant", "ui.nav.ratings") });
    await expect(link).toHaveAttribute("href", "/zh-Hant/ratings");
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("網址可分享：直接開 ?sort=players&dir=asc 就是升冪的玩家平均（伺服器端渲染）", async ({ page }) => {
    await page.goto(url("sort=players&dir=asc"));
    await ready(page);
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
    await expect(th(page, "igdb")).not.toHaveAttribute("aria-sort", /.+/);
    expect(await slugs(page)).toEqual(["e2e-big-06", "e2e-fill-10", "e2e-big-01", "e2e-big-04", "e2e-fill-02"]);
    // 名次是「分數最高＝1」，升冪只是倒著列
    expect(await page.locator("[data-rk-row] .rk-rank-n").evaluateAll((els) => els.map((e) => e.textContent))).toEqual(["5", "4", "3", "2", "1"]);
  });

  test("沒有 JS：表格與標題按鈕仍在，「載入更多」是 page=2 的一般連結，伺服器渲染前 2 頁", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, locale: "zh-TW" });
    const page = await ctx.newPage();
    await page.goto(url());
    expect(await slugs(page)).toHaveLength(50);
    const more = page.locator("[data-rk-more]");
    await expect(more).toHaveAttribute("href", "/zh-Hant/ratings?page=2");
    await page.goto(url("page=2"));
    expect(await slugs(page)).toHaveLength(F.eligibleDefault);
    await expect(page.locator("[data-rk-more]")).toHaveCount(0);
    await ctx.close();
  });

  test("HTML 小於 200 KB（fixture 資料量；真實資料量另量）", async ({ request }) => {
    for (const q of ["", "sort=players", "page=2"]) {
      const res = await request.get(url(q));
      expect(res.status()).toBe(200);
      expect((await res.body()).length).toBeLessThan(200 * 1024);
      expect(res.headers()["set-cookie"]).toBeUndefined();
    }
  });
});

test.describe("評分排名頁：排序與名次升降", () => {
  test("點「站內玩家平均」：網址、aria-sort、列、名次升降標示（含螢幕閱讀器文字）、狀態宣告", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    await expect(th(page, "igdb")).not.toHaveAttribute("aria-sort", /.+/);
    await expect(page).toHaveURL(/\/zh-Hant\/ratings\?sort=players&dir=desc$/);
    expect(await slugs(page)).toEqual(["e2e-fill-02", "e2e-big-04", "e2e-big-01", "e2e-fill-10", "e2e-big-06"]);
    await expect(page.locator("[data-rk-status]")).toHaveText(
      msg("zh-Hant", "ui.ratings.status", { total: F.playersEligible, column: msg("zh-Hant", "ui.ratings.col.players"), direction: msg("zh-Hant", "ui.ratings.dirDesc") }),
    );
    await expect(page.locator("[data-rk-status]")).toHaveAttribute("aria-live", "polite");

    // 名次升降＝上一個排序欄（IGDB）的名次 − 現在的名次；與 API 的 prevRank 一致
    const api = (await (await page.request.get("/api/v1/ratings/ranking?locale=zh-Hant&sort=players&prev=igdb")).json()) as { rows: Array<{ slug: string; rank: number; prevRank: number | null }> };
    const kinds: string[] = [];
    for (const r of api.rows) {
      const row = page.locator(`[data-rk-row="${r.slug}"]`);
      const delta = row.locator("[data-rk-delta]");
      const d = r.prevRank === null ? null : r.prevRank - r.rank;
      if (d === null || d === 0) {
        await expect(delta).toHaveCount(0);
        kinds.push("none");
      } else {
        const kind = d > 0 ? "up" : "down";
        kinds.push(kind);
        await expect(delta).toHaveAttribute("data-rk-delta", kind);
        await expect(delta.locator("[aria-hidden='true']")).toHaveText(`${d > 0 ? "▲" : "▼"}${Math.abs(d)}`);
        await expect(delta.locator(".sr-only")).toHaveText(msg("zh-Hant", d > 0 ? "ui.ratings.rankUp" : "ui.ratings.rankDown", { n: Math.abs(d), prev: r.prevRank! }));
        await expect(delta).toHaveCSS("opacity", "1"); // 動畫後淡入完成
      }
    }
    expect(kinds).toContain("up");
    expect(kinds).toContain("down");
  });

  test("再點同一欄切換升降冪（名次仍是分數最高＝1，換同欄不再有升降標示）；換回 IGDB 相對於玩家平均", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/sort=players&dir=asc$/);
    expect(await slugs(page)).toEqual(["e2e-big-06", "e2e-fill-10", "e2e-big-01", "e2e-big-04", "e2e-fill-02"]);
    await expect(page.locator("[data-rk-delta]")).toHaveCount(0);
    await sortBtn(page, "igdb").click();
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    await expect(page).toHaveURL(/sort=igdb&dir=desc$/);
    expect((await slugs(page)).slice(0, 4)).toEqual(["e2e-big-01", "e2e-big-02", "e2e-big-03", "e2e-big-04"]);
    // 相對於玩家平均：big-01 玩家第 3 → IGDB 第 1（上升 2）
    await expect(page.locator('[data-rk-row="e2e-big-01"] [data-rk-delta]')).toHaveAttribute("data-rk-delta", "up");
    await expect(page.locator('[data-rk-row="e2e-big-01"] [data-rk-delta] [aria-hidden]')).toHaveText("▲2");
  });

  test("FLIP 規格：只動 transform、250ms、cubic-bezier(0.77, 0, 0.175, 1)；新進列只淡入", async ({ page }) => {
    await recordAnimations(page);
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    const anims = await trAnims(page);
    expect(anims.length).toBeGreaterThan(0);
    const moves = anims.filter((a) => a.props.includes("transform"));
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.props).toEqual(["transform"]);
      expect(m.duration).toBe(250);
      expect(m.easing).toBe("cubic-bezier(0.77, 0, 0.175, 1)");
      expect(m.from).toMatch(/^translateY\(/);
    }
    for (const a of anims.filter((x) => !x.props.includes("transform"))) {
      expect(a.props).toEqual(["opacity"]);
      expect(a.duration).toBe(150);
    }
    // 結束後沒有殘留的 transform
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    expect(await rows(page).evaluateAll((els) => els.map((e) => getComputedStyle(e).transform))).toEqual(Array(5).fill("none"));
  });

  test("視窗外的列不做位移動畫（列數多時只動視窗內的）", async ({ page }) => {
    await recordAnimations(page);
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    const firstSort = await trAnims(page);
    expect(firstSort.filter((a) => a.props.includes("transform")).length).toBeLessThanOrEqual(5); // 結果只有 5 列
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    // 反向：從 5 列換回 50 列（視窗只有 500px、列高約 70px，視窗內約 7 列）：新進的列只有視窗內（含上下各 1/4 視窗）的才淡入，其餘直接就位
    await sortBtn(page, "igdb").click();
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    await expect(rows(page)).toHaveCount(50);
    const all = await trAnims(page);
    const second = all.slice(firstSort.length);
    expect(second.length).toBeGreaterThan(0);
    expect(second.length).toBeLessThan(20); // 不是 50
    for (const a of second) expect(a.props.length).toBe(1);
  });

  test("prefers-reduced-motion: reduce：不做位移也不淡入，名次升降標示立即出現", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordAnimations(page);
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    expect(await trAnims(page)).toEqual([]);
    const up = page.locator('[data-rk-row="e2e-fill-02"] [data-rk-delta]');
    await expect(up).toHaveAttribute("data-rk-delta", "up");
    await expect(up).toHaveCSS("opacity", "1");
  });

  test("鍵盤（Enter／Space）照常排序，但不做位移動畫", async ({ page }) => {
    await recordAnimations(page);
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").focus();
    await page.keyboard.press("Enter");
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    await expect(sortBtn(page, "players")).toBeFocused(); // 焦點不跑掉
    expect(await trAnims(page)).toEqual([]);
    await page.keyboard.press("Space");
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
    expect(await trAnims(page)).toEqual([]);
    await sortBtn(page, "igdb").focus();
    await page.keyboard.press("Enter");
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    expect(await trAnims(page)).toEqual([]);
    await expect(page.locator('[data-rk-row="e2e-big-01"] [data-rk-delta]')).toHaveCSS("opacity", "1");
  });

  test("可被下一次點擊中斷：連點兩欄，最後停在最後點的那一欄，列沒有殘留位移", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await recordAnimations(page);
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    // 位移動畫開始後立刻點回 IGDB
    await page.waitForFunction(() => (window as unknown as { __anims: unknown[] }).__anims.some((a) => (a as { tag: string }).tag === "TR"));
    await sortBtn(page, "igdb").click();
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    await expect(page).toHaveURL(/sort=igdb&dir=desc$/);
    await expect(rows(page)).toHaveCount(50);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    expect((await slugs(page)).slice(0, 4)).toEqual(["e2e-big-01", "e2e-big-02", "e2e-big-03", "e2e-big-04"]);
    expect(await rows(page).evaluateAll((els) => els.slice(0, 20).map((e) => getComputedStyle(e).transform))).toEqual(Array(20).fill("none"));
    expect(errors).toEqual([]);
  });

  test("載入更多：附加下一頁、網址帶 page、狀態宣告；之後換排序回到第一頁", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await expect(rows(page)).toHaveCount(50);
    await page.locator("[data-rk-more]").click();
    await expect(rows(page)).toHaveCount(F.eligibleDefault);
    await expect(page).toHaveURL(/\/zh-Hant\/ratings\?page=2$/);
    await expect(page.locator("[data-rk-more]")).toHaveCount(0);
    await expect(page.locator("[data-rk-status]")).toHaveText(msg("zh-Hant", "ui.ratings.loaded", { n: F.eligibleDefault - 50 }));
    // 沒有重複的列
    const all = await slugs(page);
    expect(new Set(all).size).toBe(all.length);
    await sortBtn(page, "players").click();
    await expect(rows(page)).toHaveCount(5);
    await expect(page).toHaveURL(/sort=players&dir=desc$/);
  });

  test("API 失敗時留在原本的排序並顯示錯誤（role=alert）", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await page.route("**/api/v1/ratings/ranking**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"timeout"}' }));
    await sortBtn(page, "players").click();
    await expect(page.locator("p.rk-error[role=alert]")).toHaveText(msg("zh-Hant", "ui.ratings.loadError"));
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    await expect(rows(page)).toHaveCount(50);
  });
});

test.describe("評分排名頁：篩選與最低票數", () => {
  test("?minVotes=40：只列 IGDB 評分人數 ≥ 40 的；欄位標示預設值", async ({ page }) => {
    await page.goto(url("minVotes=40"));
    await ready(page);
    expect(await slugs(page)).toEqual(["e2e-big-01", "e2e-big-02", "e2e-big-06"]);
    await expect(page.locator("input[name=minVotes]")).toHaveValue("40");
    await expect(page.locator("input[name=minVotes]")).toHaveAttribute("placeholder", "10");
  });

  test("排序依哪一欄就套哪一欄的預設門檻：玩家平均預設 5（PLAYER_RATING_MIN_COUNT）；可調高", async ({ page }) => {
    await page.goto(url("sort=players"));
    await ready(page);
    expect(await slugs(page)).toHaveLength(5);
    await expect(page.locator("input[name=minVotes]")).toHaveAttribute("placeholder", "5");
    await expect(page.locator("#f-rvotes-hint")).toContainText("5");
    await page.goto(url("sort=players&minVotes=8"));
    await ready(page);
    expect(await slugs(page)).toEqual(["e2e-fill-02", "e2e-big-01"]);
  });

  test("用篩選面板調整：最低票數、排序欄、方向都寫進網址", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await page.locator("summary", { hasText: msg("zh-Hant", "filters.title") }).first().click();
    await page.locator("select[name=sort]").selectOption("players");
    await page.locator("select[name=dir]").selectOption("asc");
    await page.locator("input[name=minVotes]").fill("6");
    await page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).first().click();
    await expect(page).toHaveURL(/sort=players/);
    await expect(page).toHaveURL(/dir=asc/);
    await expect(page).toHaveURL(/minVotes=6/);
    await ready(page);
    expect(await slugs(page)).toEqual(["e2e-big-01", "e2e-big-04", "e2e-fill-02"]);
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
  });

  test("沿用共用篩選：平台、首發年份；chip 移除連結保留排序與門檻；空結果有說明", async ({ page }) => {
    await page.goto(url("platform=e2e-pc&sort=players&minVotes=5"));
    await ready(page);
    expect(await slugs(page)).toHaveLength(5);
    const chip = page.locator("a.filter-chip").first();
    await expect(chip).toBeVisible();
    const href = (await chip.getAttribute("href"))!;
    expect(href).toContain("sort=players");
    expect(href).toContain("minVotes=5");
    expect(href).not.toContain("platform=");
    // 首發年份：只有 hero 有首發日期（2036）；時間軸 fixture 的遊戲沒有日期，被年份條件排除
    await page.goto(url("yearFrom=2036&yearTo=2036"));
    await ready(page);
    expect(await slugs(page)).toEqual(["e2e-aurora-odyssey"]);
    await page.goto(url("year=2036"));
    await ready(page);
    expect(await slugs(page)).toEqual(["e2e-aurora-odyssey"]);
    await page.goto(url("yearFrom=2038"));
    await expect(page.locator("[data-rk-row]")).toHaveCount(0);
    await expect(page.locator("td.rk-empty")).toHaveText(msg("zh-Hant", "ui.ratings.empty"));
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending"); // 空結果時標題仍在，可以改排序
  });

  test("標題排序後再送出篩選：排序欄與方向選單跟著表格目前的排序", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await sortBtn(page, "players").click();
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("select[name=sort]")).toHaveValue("players");
    await expect(page.locator("select[name=dir]")).toHaveValue("desc");
    await sortBtn(page, "players").click();
    await expect(page.locator("select[name=dir]")).toHaveValue("asc");
    await page.locator("summary", { hasText: msg("zh-Hant", "filters.title") }).first().click();
    await page.locator('input[name="platformKind"][value="pc"]').check();
    await page.getByRole("button", { name: msg("zh-Hant", "filters.apply") }).first().click();
    await expect(page).toHaveURL(/sort=players/);
    await expect(page).toHaveURL(/dir=asc/);
    await expect(th(page, "players")).toHaveAttribute("aria-sort", "ascending");
  });

  test("篩選後點標題排序：fetch 帶著同一組篩選", async ({ page }) => {
    await page.goto(url("platform=e2e-pc"));
    await ready(page);
    const req = page.waitForRequest((r) => r.url().includes("/api/v1/ratings/ranking"));
    await sortBtn(page, "players").click();
    const u = new URL((await req).url());
    expect(u.searchParams.get("platform")).toBe("e2e-pc");
    expect(u.searchParams.get("sort")).toBe("players");
    expect(u.searchParams.get("prev")).toBe("igdb");
    await expect(page).toHaveURL(/platform=e2e-pc&sort=players&dir=desc$/);
  });

  test("未知的 sort／dir／minVotes 退回預設，不出錯", async ({ page }) => {
    const res = await page.goto(url("sort=nope&dir=up&minVotes=abc"));
    expect(res!.status()).toBe(200);
    await ready(page);
    await expect(th(page, "igdb")).toHaveAttribute("aria-sort", "descending");
    expect(await slugs(page)).toHaveLength(50);
  });
});

test.describe("評分排名頁：互動細節與響應式", () => {
  test("標題按鈕：:active 為 scale(0.97)；hover 樣式只在 (hover: hover) and (pointer: fine)；沒有 transition: all", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    const btn = sortBtn(page, "players");
    const box = (await btn.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => btn.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(0\.97,/);
    await page.mouse.up();
    const report = await page.evaluate(() => {
      const out: { hoverOutsideMedia: string[]; transitionAll: string[]; easeIn: string[] } = { hoverOutsideMedia: [], transitionAll: [], easeIn: [] };
      const walk = (rules: CSSRuleList, inHover: boolean) => {
        for (const r of Array.from(rules)) {
          if (r instanceof CSSMediaRule) walk(r.cssRules, inHover || /hover:\s*hover/.test(r.conditionText));
          else if (r instanceof CSSStyleRule && /\.(rk-|cal-switch)/.test(r.selectorText)) {
            if (r.selectorText.includes(":hover") && !inHover) out.hoverOutsideMedia.push(r.selectorText);
            const t = r.style.getPropertyValue("transition");
            if (/\ball\b/.test(t)) out.transitionAll.push(r.selectorText);
            if (/ease-in(?!-out)/.test(t)) out.easeIn.push(r.selectorText);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, false);
        } catch {
          /* 跨來源樣式表 */
        }
      }
      return out;
    });
    expect(report).toEqual({ hoverOutsideMedia: [], transitionAll: [], easeIn: [] });
  });

  for (const width of [320, 375]) {
    test(`${width}px：頁面不水平溢出，表格容器可橫向捲動且鍵盤可聚焦`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(url("sort=players"));
      await ready(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const region = page.getByRole("region", { name: msg("zh-Hant", "ui.ratings.regionLabel") });
      await expect(region).toHaveAttribute("tabindex", "0");
      if (width === 320) {
        const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(scrollable).toBe(true);
      }
      // 觸控目標 ≥ 44px
      for (const s of ["igdb", "players"]) expect((await sortBtn(page, s).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test("320px 在三個語系都不溢出（字形加寬）", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      await page.goto(url("", locale));
      await ready(page);
      await page.addStyleTag({ content: "body{font-family:Verdana,sans-serif!important;letter-spacing:.04em}" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, locale).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("評分排名頁：axe（亮／暗）", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}：預設、玩家平均排序後（含名次升降標示）、320px、篩選面板展開`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url());
      await ready(page);
      await expectNoA11yViolations(page, `/ratings ${scheme}`);
      await sortBtn(page, "players").click();
      await expect(th(page, "players")).toHaveAttribute("aria-sort", "descending");
      await expect(page.locator("[data-rk-delta]").first()).toHaveCSS("opacity", "1");
      await expectNoA11yViolations(page, `/ratings players ${scheme}`);
      await page.setViewportSize({ width: 320, height: 700 });
      await expectNoA11yViolations(page, `/ratings 320 ${scheme}`);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator("summary", { hasText: msg("zh-Hant", "filters.title") }).first().click();
      await expectNoA11yViolations(page, `/ratings filter ${scheme}`);
    });
  }

  test("英文與日文頁面 axe", async ({ page }) => {
    for (const locale of ["en", "ja"] as const) {
      await page.goto(url("sort=players", locale));
      await ready(page);
      await expectNoA11yViolations(page, `/ratings ${locale}`);
    }
  });

  test("fillerScore 與 fixture 一致（防止 fixture 漂移）", async ({ page }) => {
    await page.goto(url("minVotes=0&page=2"));
    await ready(page);
    const fill59 = page.locator('[data-rk-row="e2e-fill-59"] td[data-col="igdb"] .rk-score');
    await expect(fill59).toHaveText(String(fillerScore(59)));
  });
});
