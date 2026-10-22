/**
 * e2e 共用：攔截外部圖片（不連 IGDB）、axe 檢查、讀字典字串（斷言用，避免把中英文寫死在測試裡）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { WEB_DIR } from "./env";

export { FIXTURE, FIXTURE_3B, FIXTURE_4, FIXTURE_HOME } from "./fixture-data";

export type TestLocale = "zh-Hant" | "en" | "ja";
export const LOCALES: readonly TestLocale[] = ["zh-Hant", "en", "ja"];

/** 1×1 透明 PNG。 */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** 所有測試：IGDB 圖片與 Next 圖片最佳化器的請求在瀏覽器端直接回 1×1 PNG（fixture 的封面 id 是假的，也不該連外）。 */
export const test = base.extend<{ blockImages: void }>({
  blockImages: [
    async ({ page }, use) => {
      const fulfill = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
        route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
      await page.route("https://images.igdb.com/**", fulfill);
      await page.route("**/_next/image?**", fulfill);
      await use();
    },
    { auto: true },
  ],
});
export { expect };

/** WCAG 2.0／2.1／2.2 的 A 與 AA 規則（06：目標 WCAG 2.2 AA）。 */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** 跑 axe，違規 0 才通過；失敗訊息列出規則、影響程度與前幾個節點。 */
export async function expectNoA11yViolations(page: Page, label: string, include?: string): Promise<void> {
  // 等進場動畫（側邊預覽卡淡入）跑完，否則 axe 會量到半透明的中間色
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  const summary = result.violations.map((v) => {
    const nodes = v.nodes
      .slice(0, 5)
      .map((n) => `    - ${n.target.join(" ")}\n      ${n.failureSummary?.replace(/\n/g, "\n      ") ?? ""}`)
      .join("\n");
    return `[${v.impact}] ${v.id}: ${v.help}（${v.nodes.length} 個節點）\n${nodes}`;
  });
  expect(result.passes.length, "axe 沒有實際檢查到任何規則").toBeGreaterThan(0);
  expect(summary, `axe 違規（${label}）：\n${summary.join("\n")}`).toEqual([]);
}

// ---- 字典 ----

type Dict = Record<string, unknown>;
const cache = new Map<string, Dict>();

function namespace(locale: TestLocale, ns: string): Dict {
  const key = `${locale}/${ns}`;
  let d = cache.get(key);
  if (!d) {
    d = JSON.parse(readFileSync(path.join(WEB_DIR, "..", "..", "packages", "i18n", "messages", locale, `${ns}.json`), "utf8")) as Dict;
    cache.set(key, d);
  }
  return d;
}

/** `msg("en", "ui.calendar.moreItems", { count: 5 })` → "+5 more"（數字以 Intl 加千分位，同 @sok/i18n）。 */
export function msg(locale: TestLocale, key: string, values: Record<string, string | number> = {}): string {
  const [ns, ...rest] = key.split(".");
  let cur: unknown = namespace(locale, ns!);
  for (const part of rest) cur = (cur as Dict | undefined)?.[part];
  if (typeof cur !== "string") throw new Error(`字典沒有 ${locale}:${key}`);
  return cur.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = values[name];
    if (v === undefined) return m;
    return typeof v === "number" ? new Intl.NumberFormat(locale).format(v) : v;
  });
}

export const calendarUrl = (locale: TestLocale, month: string, query = "") => `/${locale}/calendar/${month}${query ? `?${query}` : ""}`;
export const gameUrl = (locale: TestLocale, slug: string) => `/${locale}/games/${slug}`;

/** 等客戶端元件接手（月曆格水合完成、切換鈕出現）後再操作。 */
export async function waitForCalendarReady(page: Page): Promise<void> {
  await expect(page.locator('.cal-cell[data-hydrated="true"]').first()).toBeAttached();
}

// ---- header 下拉（導覽、主題、語言、帳號共用 kernel/ui/dropdown） ----

export type HeaderMenu = "nav" | "theme" | "language" | "account";

/** header 下拉的觸發按鈕與面板（不操作）。 */
export function headerMenu(page: Page, menu: HeaderMenu): { root: Locator; trigger: Locator; panel: Locator } {
  const root = page.locator(`[data-dropdown="${menu}"]`);
  return { root, trigger: root.locator("[data-dropdown-trigger]"), panel: root.locator(".dd-panel") };
}

/** 等水合後點開 header 下拉，回傳面板。已經開著就不再點。 */
export async function openHeaderMenu(page: Page, menu: HeaderMenu): Promise<Locator> {
  const { root, trigger, panel } = headerMenu(page, menu);
  await expect(root).toHaveAttribute("data-ready", "true");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  // 等開啟動畫跑完（縮放中量到的尺寸與點擊位置都會偏）
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((an) => an.finished)));
  return panel;
}

/** 開啟導覽下拉並回傳其中的主要導覽 <nav>。 */
export async function openMainNav(page: Page, locale: TestLocale): Promise<Locator> {
  const panel = await openHeaderMenu(page, "nav");
  return panel.getByRole("navigation", { name: msg(locale, "a11y.mainNavigation") });
}
