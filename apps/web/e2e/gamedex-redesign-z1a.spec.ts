/**
 * GameDex 第二輪（Z1A）e2e：Holodex 式 header（導覽／主題／語言／帳號四個共用下拉＋搜尋）、主題切換、搜尋候選 combobox、
 * 窄螢幕（320／375）排版、reduced-motion、axe（亮／暗）。固定網址進入，不依賴「今天」。
 * 截圖：設環境變數 Z1A_SHOTS=<資料夾> 時順便存圖（人工檢查用，平常不存）。
 */
import type { Locator, Page } from "@playwright/test";
import { FIXTURE, FIXTURE_3B, LOCALES, expect, expectNoA11yViolations, headerMenu, msg, openHeaderMenu, test, type HeaderMenu, type TestLocale } from "./support/helpers";
import { horizontalOverflow, signedInUser } from "./support/accounts";

const MOBILE = { width: 375, height: 812 };
const MENUS: HeaderMenu[] = ["nav", "theme", "language", "account"];
const SHOTS = process.env.Z1A_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(350); // 等進場動畫跑完
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function widenFonts(page: Page): Promise<void> {
  await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; letter-spacing: 0.05em !important; }" });
}

const headerSearchInput = (page: Page) => page.locator("#header-search");
async function waitCombobox(input: Locator): Promise<void> {
  await expect(input.locator("xpath=ancestor::*[@data-search-combobox][1]")).toHaveAttribute("data-hydrated", "true");
}
const popup = (page: Page) => page.locator("[data-search-popup]");
const options = (page: Page) => page.locator("[data-search-popup] [role=option]");

// ── 四個下拉 ───────────────────────────────────────────────────────────

test.describe("header 下拉（導覽、主題、語言、帳號）", () => {
  test("各自開合：aria-expanded／aria-controls、Esc 關閉並把焦點還給按鈕、點外面關閉", async ({ page }) => {
    await page.goto("/en/calendar/" + FIXTURE.month);
    for (const menu of MENUS) {
      const { trigger, panel } = headerMenu(page, menu);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      const id = await panel.getAttribute("id");
      expect(id).toBeTruthy();
      await expect(trigger).toHaveAttribute("aria-controls", id!);
      await expect(panel).toBeHidden();
      await openHeaderMenu(page, menu);
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
      await expect(panel).toBeHidden();

      await openHeaderMenu(page, menu);
      await page.locator("main").click({ position: { x: 3, y: 3 } }); // 面板外（面板可能蓋住標題，所以點 main 最左上角）
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("同時只開一個：開第二個時第一個自動關閉", async ({ page }) => {
    await page.goto("/en");
    await openHeaderMenu(page, "nav");
    await openHeaderMenu(page, "language");
    await expect(headerMenu(page, "nav").trigger).toHaveAttribute("aria-expanded", "false");
    await expect(headerMenu(page, "language").trigger).toHaveAttribute("aria-expanded", "true");
    await openHeaderMenu(page, "theme");
    await expect(headerMenu(page, "language").trigger).toHaveAttribute("aria-expanded", "false");
    expect(await page.locator('.dd-panel[data-open="true"]').count()).toBe(1);
  });

  test("鍵盤：↓ 開啟並移到第一項、↑↓ 繞回、Home／End、Tab 離開時關閉", async ({ page }) => {
    await page.goto("/en/calendar/" + FIXTURE.month);
    const { root, trigger, panel } = headerMenu(page, "nav");
    await expect(root).toHaveAttribute("data-ready", "true");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = panel.locator("a");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused(); // 從第一項往上繞回最後一項
    await page.keyboard.press("Home");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    // 鍵盤開啟不做動畫（data-instant）
    await expect(panel).toHaveAttribute("data-instant", "true");
    await page.keyboard.press("Tab"); // 離開下拉 → 關閉
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
  });

  test("導覽下拉標示目前頁（aria-current）；伺服器 HTML 依該頁路徑輸出、不含使用者資訊", async ({ page, request }) => {
    await page.goto("/en/timeline");
    const nav = await openHeaderMenu(page, "nav");
    await expect(nav.locator('[aria-current="page"]')).toHaveText(msg("en", "ui.nav.timeline"));
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const html = await (await request.get("/en/timeline")).text();
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("data-theme=");
  });

  test("帳號下拉：未登入是「登入」「註冊」；登入後是各分頁入口與登出", async ({ page }) => {
    await page.goto("/en");
    const guest = await openHeaderMenu(page, "account");
    await expect(guest.getByRole("link", { name: msg("en", "accounts.header.signIn") })).toHaveAttribute("href", "/en/login");
    await expect(guest.getByRole("link", { name: msg("en", "accounts.header.signUp") })).toHaveAttribute("href", "/en/signup");
    await shot(page, "dropdown-account-guest");
    await signedInUser(page, "z1a-menu", "Z1A 測試者");
    await page.goto("/en");
    const panel = await openHeaderMenu(page, "account");
    await expect(headerMenu(page, "account").trigger).toHaveAccessibleName(msg("en", "accounts.header.menu", { name: "Z1A 測試者" }));
    await expect(panel.getByRole("link")).toHaveCount(9);
    await expect(panel.getByRole("link", { name: msg("en", "accounts.account.tab.lists") })).toHaveAttribute("href", "/en/account/lists");
    await expect(panel.getByRole("button", { name: msg("en", "accounts.header.signOut") })).toBeVisible();
    await shot(page, "dropdown-account-user");
  });

  test("沒有 JS：導覽連結仍在（noscript 清單）、不會因為少了下拉而無法瀏覽", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto("/en/calendar/" + FIXTURE.month);
    const nav = page.getByRole("navigation", { name: msg("en", "a11y.mainNavigation") });
    await expect(nav.getByRole("link")).toHaveCount(8);
    // 搜尋框沒有 JS 也是一般表單
    await ctx.close();
  });
});

// ── 主題 ───────────────────────────────────────────────────────────────

test.describe("主題下拉", () => {
  // 切換主題有 ≤200ms 的 crossfade（theme-fade class）：等它結束再量底色
  const bg = async (page: Page) => {
    await expect(page.locator("html")).not.toHaveClass(/theme-fade/);
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  };
  const LIGHT_BG = "rgb(238, 241, 247)";
  const DARK_BG = "rgb(10, 15, 28)";

  test("預設跟隨系統；選暗色／亮色立即套用、重新整理仍保留；選回系統恢復", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const panel = await openHeaderMenu(page, "theme");
    await expect(panel.getByRole("button")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: msg("en", "ui.theme.system") })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "dropdown-theme");

    await panel.getByRole("button", { name: msg("en", "ui.theme.dark") }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg(page)).toBe(DARK_BG); // 系統是亮色，但明確選暗色
    await expect(headerMenu(page, "theme").trigger).toHaveAttribute("aria-expanded", "false");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg(page)).toBe(DARK_BG);
    // 首次繪製前就套用（<head> inline script）：新分頁的 DOMContentLoaded 時屬性已經在
    const early = await page.evaluate(async () => {
      const res = await fetch(location.href);
      return (await res.text()).includes("localStorage.getItem");
    });
    expect(early).toBe(true);
    const panel2 = await openHeaderMenu(page, "theme");
    await expect(panel2.getByRole("button", { name: msg("en", "ui.theme.dark") })).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page, "暗色主題（系統為亮色）");

    await panel2.getByRole("button", { name: msg("en", "ui.theme.system") }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await bg(page)).toBe(LIGHT_BG);
    expect(await page.evaluate(() => localStorage.getItem("sok-theme"))).toBeNull();
  });

  test("系統是暗色時選亮色 → 亮色；導覽到別頁／別語系仍保留", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/zh-Hant");
    expect(await bg(page)).toBe(DARK_BG);
    const panel = await openHeaderMenu(page, "theme");
    await panel.getByRole("button", { name: msg("zh-Hant", "ui.theme.light") }).click();
    expect(await bg(page)).toBe(LIGHT_BG);
    await expectNoA11yViolations(page, "亮色主題（系統為暗色）");
    await page.goto("/ja/platforms");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bg(page)).toBe(LIGHT_BG);
  });

  test("localStorage 被封鎖時頁面照常渲染（讀寫都包 try/catch）", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/en");
    const panel = await openHeaderMenu(page, "theme");
    await panel.getByRole("button", { name: msg("en", "ui.theme.dark") }).click(); // 寫入失敗但仍套用於本頁
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(errors).toEqual([]);
  });
});

// ── 搜尋候選 ───────────────────────────────────────────────────────────

test.describe("搜尋候選（共用 combobox）", () => {
  test("header：打字出現候選（封面、標題、年份、平台）、最多 8 筆、最後一列查看全部；ARIA 屬性齊全", async ({ page }) => {
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.click();
    await input.pressSequentially("Aurora");
    await expect(popup(page)).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const listId = await input.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    await expect(page.locator(`#${listId}`)).toHaveAttribute("role", "listbox");
    const n = await options(page).count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(9); // 最多 8 筆候選 + 查看全部
    await expect(options(page).last()).toHaveText(msg("en", "ui.search.viewAll"));
    const first = options(page).first();
    await expect(first.locator(".sb-title")).toContainText("Aurora");
    await expect(first.locator(".sb-meta")).toContainText(/\d{4}/);
    await expect(first.locator("img.sb-cover, span.sb-cover")).toHaveCount(1);
    // 結果數以 aria-live 宣告
    await expect(page.locator("[data-search-status]").first()).toHaveText(msg("en", "ui.search.count", { n: n - 1 }));
    await shot(page, "search-suggestions");
    await expectNoA11yViolations(page, "搜尋候選展開");
  });

  test("標題依介面語言：中文介面顯示中文標題，英文介面顯示原名", async ({ page }) => {
    await page.goto("/zh-Hant/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill(FIXTURE.hero.zhName.slice(0, 3));
    await expect(options(page).first().locator(".sb-title")).toHaveText(FIXTURE.hero.zhName);
    await page.goto("/en/platforms");
    await waitCombobox(input);
    await input.fill("Aurora Odyssey");
    await expect(options(page).first().locator(".sb-title")).toHaveText(FIXTURE.hero.name); // 完全符合排第一
  });

  test("↑↓ 選取（aria-activedescendant／aria-selected）、Enter 進入詳情頁", async ({ page }) => {
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill("Aurora Odyssey");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const first = options(page).first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await expect(input).toBeFocused(); // 焦點一直留在輸入框
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/en/games/${FIXTURE.hero.slug}`);
    await expect(page.locator("main h1").first()).toContainText(FIXTURE.hero.name);
  });

  test("鍵盤移到「查看全部結果」再 Enter → 現有搜尋結果頁；沒選中項時 Enter 直接送出表單", async ({ page }) => {
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("ArrowUp"); // 從沒選中往上 → 最後一列（查看全部）
    await expect(options(page).last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/en\/games\?q=Aurora/);
    await expect(page.locator("main h1").first()).toBeVisible();

    await page.goto("/en/platforms");
    await waitCombobox(input);
    await input.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Enter"); // 沒有選中項 → 一般送出
    await page.waitForURL(/\/en\/games\?q=Aurora/);
  });

  test("Esc 先關清單、再按一次清空；點外面關閉；點候選進詳情頁", async ({ page }) => {
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill("Aurora");
    await expect(popup(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
    await expect(input).toHaveValue("Aurora");
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    await input.fill("Aurora");
    await expect(popup(page)).toBeVisible();
    await page.locator("main").click({ position: { x: 3, y: 3 } });
    await expect(popup(page)).toHaveCount(0);
    await input.click();
    await input.fill("Aurora Odyssey");
    await options(page).first().click();
    await page.waitForURL(`**/en/games/${FIXTURE.hero.slug}`);
  });

  test("找不到：顯示「找不到」一列並以 aria-live 宣告", async ({ page }) => {
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill("zzzzqqqq nothing");
    await expect(page.locator("[data-search-empty]")).toHaveText(msg("en", "ui.search.empty"));
    await expect(page.locator("[data-search-status]").first()).toHaveText(msg("en", "ui.search.empty"));
    await expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("debounce 與可取消：快速打字只送最後一次；慢的舊回應不會蓋掉新結果", async ({ page }) => {
    const seen: string[] = [];
    await page.route("**/api/v1/games/suggest**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      seen.push(q);
      if (q === "Au") {
        await new Promise((r) => setTimeout(r, 900));
        await route.fulfill({ json: { items: [{ slug: "stale-au", name: "STALE RESULT", originalName: "STALE RESULT", coverUrl: null, year: 2000, platforms: [] }] } });
        return;
      }
      await route.fulfill({ json: { items: [{ slug: "fresh-aur", name: "FRESH RESULT", originalName: "FRESH RESULT", coverUrl: null, year: 2001, platforms: ["PC"] }] } });
    });
    await page.goto("/en/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.click();
    await page.keyboard.type("A");
    await page.keyboard.type("u");
    await page.waitForTimeout(260); // 過 debounce → 送出 "Au"（慢）
    await page.keyboard.type("r");
    await expect(options(page).first().locator(".sb-title")).toHaveText("FRESH RESULT");
    await page.waitForTimeout(1000); // 舊的 "Au" 回應此時才到
    await expect(options(page).first().locator(".sb-title")).toHaveText("FRESH RESULT");
    await expect(page.getByText("STALE RESULT")).toHaveCount(0);
    expect(seen).toEqual(["Au", "Aur"]); // 'A' 在 debounce 內被 'u' 取代，沒有送出
  });

  test("中文輸入法組字中不查詢、Enter 不送出；組字結束才查詢", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v1/games/suggest**", async (route) => {
      calls++;
      await route.fulfill({ json: { items: [{ slug: "ime-hit", name: "IME HIT", originalName: "IME HIT", coverUrl: null, year: null, platforms: [] }] } });
    });
    await page.goto("/zh-Hant/platforms");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.focus();
    await input.evaluate((el: HTMLInputElement) => {
      const setValue = (v: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
      };
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setValue("ㄐ");
      setValue("極");
    });
    await page.waitForTimeout(400);
    expect(calls).toBe(0);
    // 組字中按 Enter（確認選字）不可送出表單
    const navigated = page.waitForURL(/\/games\?q=/, { timeout: 800 }).then(() => true, () => false);
    await input.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    });
    expect(await navigated).toBe(false);
    await input.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "極" }));
    });
    await expect(options(page).first().locator(".sb-title")).toHaveText("IME HIT");
    expect(calls).toBe(1);
  });

  test("首頁與遊戲列表頁的搜尋框也有候選；列表頁的「查看全部」保留其他篩選", async ({ page }) => {
    await page.goto("/en");
    const home = page.locator("#home-search");
    await waitCombobox(home);
    await home.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await expect(page.locator("form[role=search] [data-search-popup]").first()).toBeVisible();
    await shot(page, "search-home");

    await page.goto("/en/games?yearFrom=2030");
    const browse = page.locator("#browse-search");
    await waitCombobox(browse);
    await browse.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await expect(page.getByLabel(msg("en", "ui.games.searchLabel"), { exact: true }).first()).toBeAttached();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/en\/games\?.*q=Aurora/);
    expect(new URL(page.url()).searchParams.get("yearFrom")).toBe("2030");
  });

  test("沒有 JS：搜尋框是一般表單，送出到 /games?q=", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto("/en");
    await page.locator("#home-search").fill("Aurora");
    await page.locator("#home-search").press("Enter");
    await page.waitForURL(/\/en\/games\?q=Aurora/);
    await ctx.close();
  });
});

// ── 窄螢幕：搜尋圖示與覆蓋式搜尋列 ─────────────────────────────────────

test.describe("手機 375：搜尋縮成圖示", () => {
  test.use({ viewport: MOBILE });

  test("點圖示展開覆蓋 header 的搜尋列並聚焦；Esc 收回、焦點回到圖示按鈕", async ({ page }) => {
    await page.goto("/en/platforms");
    const open = page.locator(".hs-open");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await expect(open).toBeVisible();
    await expect(input).toBeHidden();
    await shot(page, "header-mobile-375");
    await open.click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const header = (await page.locator("header.site-header").boundingBox())!;
    const form = (await page.locator(".hs-form").boundingBox())!;
    expect(form.width).toBeGreaterThanOrEqual(header.width - 2);
    expect(form.y).toBeLessThanOrEqual(header.y + 1);
    await input.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await shot(page, "header-mobile-search-open");
    await page.keyboard.press("Escape"); // 關清單
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape"); // 清空
    await expect(input).toHaveValue("");
    await page.keyboard.press("Escape"); // 收回
    await expect(input).toBeHidden();
    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute("aria-expanded", "false");
    // 關閉鈕也能收回
    await open.click();
    await page.getByRole("button", { name: msg("en", "ui.search.close") }).click();
    await expect(input).toBeHidden();
  });
});

test.describe("寬螢幕：搜尋框直接顯示", () => {
  test("1280：沒有搜尋圖示按鈕、搜尋框在 header 中間", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await expect(page.locator(".hs-open")).toBeHidden();
    await expect(input).toBeVisible();
    const box = (await input.boundingBox())!;
    expect(box.x).toBeGreaterThan(250);
    expect(box.x + box.width).toBeLessThan(1280 - 100);
    expect((await page.locator("header.site-header").boundingBox())!.height).toBeLessThan(80);
    await shot(page, "header-desktop-light");
  });
});

// ── 版面：各寬度不溢出、不重疊 ─────────────────────────────────────────

test.describe("header 版面", () => {
  for (const width of [320, 375, 768, 1280]) {
    for (const locale of LOCALES) {
      test(`${width}px ${locale}：不水平溢出、所有控制項在視窗內且互不重疊（含字形加寬）`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}`);
        await expect(headerMenu(page, "nav").root).toHaveAttribute("data-ready", "true");
        for (const wide of [false, true]) {
          if (wide) await widenFonts(page);
          expect(await horizontalOverflow(page), `${wide ? "字形加寬後" : ""}`).toBeLessThanOrEqual(0);
          const boxes = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>(".site-header .hd-brand, .site-header .dd-trigger, .site-header .hs-open, .site-header .hs-input"))
              .filter((e) => e.getBoundingClientRect().width > 0)
              .map((e) => {
                const r = e.getBoundingClientRect();
                return { name: (e.className || e.tagName).toString().slice(0, 30), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
              }),
          );
          for (const b of boxes) {
            expect(b.left, `${b.name} 左緣`).toBeGreaterThanOrEqual(0);
            expect(b.right, `${b.name} 右緣`).toBeLessThanOrEqual(width + 0.5);
          }
          const sorted = boxes.filter((b) => !b.name.includes("hs-submit")).sort((a, b) => a.left - b.left); // 送出鈕疊在輸入框內，不算重疊
          for (let i = 1; i < sorted.length; i++) {
            const a = sorted[i - 1]!;
            const b = sorted[i]!;
            const sameRow = Math.abs(a.top - b.top) < 20;
            if (sameRow) expect(b.left, `${a.name} 與 ${b.name} 重疊`).toBeGreaterThanOrEqual(a.right - 0.5);
          }
        }
      });
    }
  }
});

test.describe("下拉面板在窄螢幕不超出視窗", () => {
  for (const width of [320, 375]) {
    test(`${width}px：四個下拉展開後面板都在視窗內（含字形加寬）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/ja");
      await widenFonts(page);
      for (const menu of MENUS) {
        const panel = await openHeaderMenu(page, menu);
        const box = (await panel.boundingBox())!;
        expect(box.x, `${menu} 左緣`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${menu} 右緣`).toBeLessThanOrEqual(width);
        expect(await horizontalOverflow(page), `${menu} 展開時`).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
      }
    });
  }
});

// ── 減少動態 ───────────────────────────────────────────────────────────

test.describe("減少動態", () => {
  test.use({ reducedMotion: "reduce" });
  test("下拉與搜尋候選功能正常、面板沒有位移縮放", async ({ page }) => {
    await page.goto("/en");
    const panel = await openHeaderMenu(page, "language");
    expect(await panel.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    const input = headerSearchInput(page);
    await waitCombobox(input);
    await input.fill("Aurora");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/en\/games\//);
  });
});

// ── 動畫規格（emil-design-eng）──────────────────────────────────────────

test.describe("下拉動畫規格", () => {
  test("只 transition transform／opacity／visibility；進場從 0.96 縮放；從觸發按鈕那一側長出；關閉比開啟快", async ({ page }) => {
    await page.goto("/en");
    const { root } = headerMenu(page, "theme");
    await expect(root).toHaveAttribute("data-ready", "true");
    const info = await page.locator('[data-dropdown="theme"] .dd-panel').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { props: cs.transitionProperty, origin: cs.transformOrigin, dur: cs.transitionDuration, transform: cs.transform, scaleLeft: cs.left };
    });
    expect(info.props).not.toMatch(/\ball\b/);
    expect(info.props.split(",").map((p) => p.trim()).sort()).toEqual(["opacity", "transform", "visibility"]);
    expect(info.transform).toBe("matrix(0.96, 0, 0, 0.96, 0, 0)");
    // 靠右的主題按鈕：從右上角長出
    const box = (await page.locator('[data-dropdown="theme"] .dd-panel').boundingBox())!;
    const origin = info.origin.split(" ").map((v) => Number.parseFloat(v));
    expect(origin[0]!).toBeGreaterThan(box.width * 0.9);
    expect(origin[1]!).toBeLessThan(2);
    // 開啟 180ms、關閉 120ms
    const closedDur = info.dur.split(",").map((d) => Number.parseFloat(d));
    expect(Math.max(...closedDur)).toBeLessThanOrEqual(0.12 + 1e-6);
    await openHeaderMenu(page, "theme");
    const openDur = await page.locator('[data-dropdown="theme"] .dd-panel').evaluate((el) => getComputedStyle(el).transitionDuration.split(",").map((d) => Number.parseFloat(d)));
    expect(Math.max(...openDur)).toBeCloseTo(0.18, 2);
    // 觸發按鈕：只 transition 背景色與 transform（按下縮放 0.97 用 transform）
    const triggerProps = await headerMenu(page, "theme").trigger.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(triggerProps.split(",").map((p) => p.trim())).not.toContain("all");
    expect(triggerProps).toContain("transform");
  });
});

// ── axe：四個下拉展開（亮／暗、三語）──────────────────────────────────

test.describe("axe：header 下拉展開", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const locale of LOCALES) {
      test(`${locale} ${scheme}：導覽、主題、語言、帳號下拉各展開時無違規`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/${locale}/calendar/${FIXTURE.month}`);
        for (const menu of MENUS) {
          await openHeaderMenu(page, menu);
          await expectNoA11yViolations(page, `${locale} ${scheme} ${menu} 下拉`);
          if (locale === "en" && scheme === "light" && menu !== "account") await shot(page, `dropdown-${menu}`);
          if (locale === "en" && menu === "nav") await shot(page, `dropdown-nav-${scheme}`);
          await page.keyboard.press("Escape");
        }
      });
    }
  }

  test.describe("截圖", () => {
  test.use({ timezoneId: "Asia/Taipei" });
  test("header 截圖（桌機亮／暗）與活動頁時間顯示", async ({ page }) => {
    test.skip(!SHOTS, "只在 Z1A_SHOTS 設定時存圖");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/en");
      await expect(page.locator("main h1").first()).toBeVisible();
      await shot(page, `header-desktop-${scheme}`);
    }
    await page.goto(`/en/events/${FIXTURE_3B.events.showcase.slug}`);
    await expect(page.locator('[data-event-time="local"]')).toContainText("GMT");
    await shot(page, "event-time");
  });
  });
});

export type { TestLocale };
