/**
 * Phase 9 準備（H）：法務頁、頁尾連結、錯誤頁的快取訊號。
 * - 法務頁 `/[locale]/about/{data-sources,privacy,terms,contact}`：三語 axe（桌機、375、320 無水平溢出）、可快取、無 Set-Cookie、
 *   草稿提示、進 sitemap；頁尾連結（每個語系）。
 * - 錯誤頁：啟動第二個伺服器（同一份建置、連一個沒有任何表的空資料庫 → 查詢必定失敗），驗證錯誤回應仍是 200 且
 *   HTML 以 Next 的錯誤外殼開頭——Next 層無法改狀態碼或標頭（見 infra/cloudflare/cache-rules.md「錯誤頁不可被 CDN 快取」），
 *   所以由 Cloudflare Snippet 依這個前綴改成 no-store。這裡直接執行 cache-rules.md 裡標記範圍內的判斷程式碼，證明文件上的規則對真實回應有效。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { E2E_PORT, E2E_SITE_ORIGIN, WEB_DIR, serverEnv, testDatabaseUrl } from "./support/env";
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const PAGES = ["data-sources", "privacy", "terms", "contact"] as const;
const NAV_KEY = { "data-sources": "dataSources", privacy: "privacy", terms: "terms", contact: "contact" } as const;
const url = (locale: TestLocale, page: (typeof PAGES)[number]) => `/${locale}/about/${page}`;

test.describe("法務頁", () => {
  for (const locale of LOCALES) {
    for (const page of PAGES) {
      test.describe(`${locale} /about/${page}`, () => {
        test("200、可快取、無 Set-Cookie、草稿提示、canonical", async ({ request }) => {
          const res = await request.get(url(locale, page));
          expect(res.status()).toBe(200);
          const cc = res.headers()["cache-control"] ?? "";
          expect(cc).toMatch(/s-maxage=\d+/);
          expect(cc).not.toMatch(/no-store|private/);
          expect(res.headers()["set-cookie"]).toBeUndefined();
          const html = await res.text();
          expect(html).toContain(`<html lang="${locale}"`);
          expect(html).toContain(`href="${E2E_SITE_ORIGIN}${url(locale, page)}"`); // canonical／hreflang
          expect(html).toContain(msg(locale, `about.${NAV_KEY[page]}.title`).replace(/&/g, "&amp;"));
          // 內容是草稿：頁面明示需專業人士審閱
          expect(html).toContain(msg(locale, "about.draft.title"));
          expect(html).toContain(msg(locale, "about.draft.body").slice(0, 12));
        });

        test("axe：桌機", async ({ page: pw }) => {
          await pw.goto(url(locale, page));
          await expect(pw.locator("main h1")).toHaveText(msg(locale, `about.${NAV_KEY[page]}.title`));
          await expectNoA11yViolations(pw, `${locale} /about/${page} 桌機`);
        });

        for (const width of [375, 320]) {
          test(`axe 與水平溢出：手機 ${width} 寬`, async ({ page: pw }) => {
            await pw.setViewportSize({ width, height: 812 });
            await pw.goto(url(locale, page));
            await expect(pw.locator("main h1")).toBeVisible();
            const overflow = await pw.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow, `${width} 寬不可水平捲動（溢出 ${overflow}px）`).toBeLessThanOrEqual(0);
            await expectNoA11yViolations(pw, `${locale} /about/${page} ${width}`);
          });
        }
      });
    }
  }

  test("資料來源頁：IGDB 署名連結、封面圖著作權說明", async ({ page }) => {
    await page.goto(url("en", "data-sources"));
    await expect(page.locator('main a[href="https://www.igdb.com/"]')).toBeVisible();
    await expect(page.getByText("belong to their respective publishers")).toBeVisible();
  });

  test("隱私頁：如實寫出唯一的 Cookie 與備份保留期", async ({ page }) => {
    await page.goto(url("en", "privacy"));
    await expect(page.getByText("sok_locale").first()).toBeVisible();
    await expect(page.getByText("7 days (daily), 4 weeks (weekly) and 6 months (monthly)")).toBeVisible();
  });

  test("聯絡頁：下架申請的步驟與回報類型名稱，和回報表單的字典一致", async ({ page }) => {
    await page.goto(url("en", "contact"));
    await expect(page.getByText(msg("en", "ui.report.type.takedown"), { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: msg("en", "about.contact.findGame") })).toHaveAttribute("href", "/en/games");
  });

  test("pages.xml 列出四個法務頁 × 三語", async ({ request }) => {
    const res = await request.get("/sitemap/pages.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    for (const locale of LOCALES) {
      for (const page of PAGES) expect(xml).toContain(`<loc>${E2E_SITE_ORIGIN}/${locale}/about/${page}</loc>`);
    }
  });
});

test.describe("頁尾連結", () => {
  for (const locale of LOCALES) {
    test(`${locale}：四個法務連結＋IGDB 署名都在，且可點進去`, async ({ page }) => {
      await page.goto(`/${locale}/calendar/${FIXTURE.month}`);
      const footer = page.locator("footer");
      await expect(footer.locator('a[href="https://www.igdb.com/"]')).toBeVisible();
      const nav = footer.getByRole("navigation", { name: msg(locale, "about.nav.label") });
      for (const p of PAGES) {
        await expect(nav.locator(`a[href="${url(locale, p)}"]`)).toHaveText(msg(locale, `about.nav.${NAV_KEY[p]}`));
      }
      await nav.locator(`a[href="${url(locale, "privacy")}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${url(locale, "privacy")}$`));
      await expect(page.locator("main h1")).toHaveText(msg(locale, "about.privacy.title"));
    });
  }
});

// ── 錯誤頁 ───────────────────────────────────────────────────────────────
// 第二個伺服器：沿用同一份建置（E2E_DIST_DIR），資料庫換成一個「沒有任何表」的空庫，所有查詢必定失敗（確定性；
// 用 CATALOG_READ_TIMEOUT_MS=1 製造逾時並不穩定，很快的查詢可能在 1 ms 內完成）。錯誤邊界與查詢逾時走同一條路徑。

const ERROR_PORT = E2E_PORT + 1;
const ERROR_ORIGIN = `http://localhost:${ERROR_PORT}`;
/** 會送 s-maxage 的動態頁（next.config.ts headers()）。 */
const DYNAMIC_PAGES = ["/en/games", "/en/timeline", "/en/trending", `/en/calendar/${FIXTURE.month}`, "/en/platforms", "/en/events"];

/** 取出 cache-rules.md 裡 `// BEGIN error-shell-check` 到 `// END error-shell-check` 的判斷程式碼並載入。 */
function loadDocumentedCheck(): (status: number, contentType: string, head: string) => boolean {
  // Windows CRLF checkout 時統一成 LF 再找標記
  const md = readFileSync(path.join(WEB_DIR, "..", "..", "infra", "cloudflare", "cache-rules.md"), "utf8").replace(/\r\n/g, "\n");
  const begin = "// BEGIN error-shell-check\n";
  const end = "// END error-shell-check";
  const from = md.indexOf(begin);
  const to = md.indexOf(end);
  if (from < 0 || to < from) throw new Error("cache-rules.md 找不到 error-shell-check 區塊");
  // 載入的是 repo 內的文件程式碼（不是外部輸入）
  return new Function(`${md.slice(from + begin.length, to)}\nreturn isNextErrorShell;`)() as (status: number, contentType: string, head: string) => boolean;
}

test.describe.serial("錯誤頁的快取訊號", () => {
  let child: ChildProcess | undefined;
  let emptyDbUrl = "";

  test.beforeAll(async () => {
    // 空資料庫：名稱以 _test 結尾（沿用測試資料庫的安全檢查）
    const base = new URL(testDatabaseUrl());
    const dbName = `${base.pathname.slice(1)}_err_test`;
    const admin = new URL(base);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
    } finally {
      await c.end();
    }
    const dbUrl = new URL(base);
    dbUrl.pathname = `/${dbName}`;
    emptyDbUrl = dbUrl.toString();

    const nextBin = require.resolve("next/dist/bin/next", { paths: [WEB_DIR] });
    child = spawn(process.execPath, [nextBin, "start", "-p", String(ERROR_PORT)], {
      cwd: WEB_DIR,
      env: { ...serverEnv(), DATABASE_URL: emptyDbUrl, PORT: String(ERROR_PORT) },
      stdio: "ignore",
    });
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`${ERROR_ORIGIN}/healthz`)).ok) break;
      } catch {
        // 還沒起來
      }
      if (Date.now() > deadline) throw new Error("錯誤頁測試用的第二個伺服器沒有在 90 秒內啟動");
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(async () => {
    child?.kill();
    if (!emptyDbUrl) return;
    const url = new URL(emptyDbUrl);
    const dbName = url.pathname.slice(1);
    url.pathname = "/postgres";
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await c.end();
    }
  });

  for (const route of DYNAMIC_PAGES) {
    test(`資料庫失敗：${route} 仍是 200＋s-maxage（Next 層無法改），HTML 以錯誤外殼開頭；文件上的 Snippet 判斷會把它改成 no-store`, async () => {
      const isErrorShell = loadDocumentedCheck();
      const res = await fetch(`${ERROR_ORIGIN}${route}`);
      const html = await res.text();
      const type = res.headers.get("content-type") ?? "";
      const cacheControl = res.headers.get("cache-control") ?? "";
      test.info().annotations.push({ type: "error-response", description: `status ${res.status}; cache-control: ${cacheControl}` });
      // 特徵化：這是目前 Next 16.4 的行為（串流開始後無法改狀態碼與標頭）。若哪天變成 5xx 或 no-store，這裡會失敗——
      // 屆時可以拿掉 Cloudflare Snippet，並更新 infra/cloudflare/cache-rules.md。
      expect(res.status).toBe(200);
      expect(cacheControl).toMatch(/s-maxage=\d+/);
      expect(html.startsWith('<!DOCTYPE html><html id="__next_error__">')).toBe(true);
      expect(isErrorShell(res.status, type, html.slice(0, 120))).toBe(true);
      // 錯誤頁（含客戶端渲染用的串流資料）不可洩漏連線字串、堆疊、SQL
      expect(html).not.toMatch(/postgres(ql)?:\/\//i);
      expect(html).not.toMatch(/\bat\s+\S+\s+\(.*\.js:\d+:\d+\)/);
      expect(html).not.toMatch(/relation "\w+" does not exist|SELECT\s/i);
    });
  }

  test("正常頁面不會被 Snippet 判成錯誤", async () => {
    const isErrorShell = loadDocumentedCheck();
    for (const p of ["/en/subscribe", "/en/about/privacy", `/en/calendar/${FIXTURE.month}`, "/en/timeline"]) {
      const res = await fetch(`http://localhost:${E2E_PORT}${p}`);
      const html = await res.text();
      expect(isErrorShell(res.status, res.headers.get("content-type") ?? "", html.slice(0, 120)), p).toBe(false);
    }
  });
});
