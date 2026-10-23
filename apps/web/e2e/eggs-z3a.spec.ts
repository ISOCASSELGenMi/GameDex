/**
 * GameDex 第二輪 Z3A：互動背景、彩蛋 1～6／8、成就（瀏覽器端）、隱藏主題。
 * 測試掛鉤 window.__eggTest 只在 e2e 建置存在（NEXT_PUBLIC_EGG_TEST，env.ts 的 serverEnv）；
 * 點擊／鍵盤／拖曳都用真實輸入（page.mouse、page.keyboard），掛鉤只用來擺放符號與讀狀態。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";
import { headerMenu, openHeaderMenu } from "./support/helpers";
import { signedInUser } from "./support/accounts";

// 截圖只在設了 Z3A_SHOTS_DIR 時輸出（一般 CI 不寫檔）
const SHOTS = process.env.Z3A_SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const snap = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), ...(clip ? { clip } : {}) });
};

const THEMES = ["sony-blue", "xbox-green", "nintendo-red", "eight-bit", "gold", "standby-purple", "arcade-neon", "night-owl", "coding"] as const;
const THEME_LABEL: Record<(typeof THEMES)[number], string> = {
  "sony-blue": "deepBlue",
  "xbox-green": "emerald",
  "nintendo-red": "crimson",
  "eight-bit": "eightBit",
  gold: "gold",
  "standby-purple": "standbyPurple",
  "arcade-neon": "arcadeNeon",
  "night-owl": "nightOwl",
  coding: "coding",
};
const COLLECTIBLES = ["cartridge", "floppy", "cd", "dvd", "bluray", "memory-card", "game-card", "cloud"] as const;
const AT = "2026-10-01T00:00:00.000Z";

type Rec = { type: string; key: string; at: string };
interface Egg {
  records(): Rec[];
  unlock(type: string, key: string): boolean;
  registerSync(impl: { push(local: Rec[]): Promise<Rec[]> } | null): void;
  field?: {
    ready: true;
    reducedMotion: boolean;
    symbols(): { kind: string; x: number; y: number; alive: boolean; visible: boolean; ax: number; ay: number; collectible?: boolean }[];
    mode(): { wide: boolean; alpha: number; symbols: number };
    isBackgroundAt(x: number, y: number): boolean;
    place(kind: string, x: number, y: number): boolean;
    findEmptySpot(): { x: number; y: number } | null;
    forceIdle(): void;
    isGathered(): boolean;
    setGatherCenter(x: number, y: number): void;
    frames(): number;
  };
}
/** 在頁面內呼叫 window.__eggTest（函式以原始碼序列化，引數需可 JSON 化）。 */
const egg = (page: Page) => ({
  eval: <T, A>(fn: (e: Egg, a: A) => T, arg: A): Promise<T> =>
    page.evaluate<T>(`(${fn.toString()})(window.__eggTest, ${JSON.stringify(arg ?? null)})`),
});

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __eggTest?: Egg }).__eggTest?.field?.ready, undefined, { timeout: 15_000 });
}

async function open(page: Page, url = "/en"): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as { __eggTest?: Egg }).__eggTest?.records);
}

async function seedUnlocks(page: Page, recs: Rec[], theme?: string): Promise<void> {
  await page.addInitScript(
    ([r, t]) => {
      if (!localStorage.getItem("sok-unlocks")) localStorage.setItem("sok-unlocks", JSON.stringify(r));
      if (t && !localStorage.getItem("sok-theme")) localStorage.setItem("sok-theme", t as string);
    },
    [recs, theme ?? null] as [Rec[], string | null],
  );
}

const themeRecs = (keys: readonly string[]): Rec[] => keys.map((key) => ({ type: "theme", key, at: AT }));

async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const s = await egg(page).eval((e) => e.field!.findEmptySpot(), null);
  expect(s, "頁面上找不到可點的空白背景").not.toBeNull();
  return s!;
}

/** 把某種符號放到空白處，用真實滑鼠點它。 */
async function breakSymbol(page: Page, kind: string): Promise<void> {
  const spot = await emptySpot(page);
  const ok = await egg(page).eval((e, a) => e.field!.place(a.kind, a.x, a.y), { kind, x: spot.x, y: spot.y });
  expect(ok, `背景沒有 ${kind}`).toBe(true);
  await page.mouse.click(spot.x, spot.y);
}

const toast = (page: Page, key: string) => page.locator(`.egg-toast[data-unlock-key="${key}"]`);

test.describe("互動背景", () => {
  test("canvas 在內容下層、不擋點擊、aria-hidden；符號數量與種類齊全", async ({ page }) => {
    await open(page);
    await ready(page);
    const canvas = page.locator("[data-egg-canvas]");
    await expect(canvas).toHaveAttribute("aria-hidden", "true");
    const style = await canvas.evaluate((el) => {
      const s = getComputedStyle(el);
      return { pe: s.pointerEvents, z: s.zIndex, pos: s.position };
    });
    expect(style).toEqual({ pe: "none", z: "-1", pos: "fixed" });
    // 每一點都不會取到 canvas（它不參與 hit test）
    const hit = await page.evaluate(() => {
      for (let y = 0; y < innerHeight; y += 40) for (let x = 0; x < innerWidth; x += 40) if (document.elementFromPoint(x, y)?.hasAttribute("data-egg-canvas")) return true;
      return false;
    });
    expect(hit).toBe(false);
    const kinds = new Set((await egg(page).eval((e) => e.field!.symbols(), null)).map((s) => s.kind));
    for (const k of ["triangle", "circle", "cross", "square", "btn-a", "btn-b", "btn-x", "btn-y", "dpad-up", "dpad-down", "dpad-left", "dpad-right", "stick"])
      expect(kinds.has(k), k).toBe(true);
    // 按鈕照常運作
    await openHeaderMenu(page, "theme");
    await expect(headerMenu(page, "theme").trigger).toHaveAttribute("aria-expanded", "true");
    await snap(page, "background-light.png");
  });

  test("暗色背景截圖；點在內容（文字、卡片）上不會點破符號", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, `/en/calendar/${FIXTURE.month}`);
    await ready(page);
    const spot = await emptySpot(page);
    // 把符號放在一段文字正上方：點文字不應點破
    const heading = page.locator("main h1").first();
    const box = (await heading.boundingBox())!;
    const cx = box.x + Math.min(10, box.width / 2);
    const cy = box.y + box.height / 2;
    await egg(page).eval((e, a) => e.field!.place("triangle", a.x, a.y), { x: cx, y: cy });
    await page.mouse.click(cx, cy);
    const alive = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "triangle")!;
    expect(alive.alive).toBe(true);
    // 點空白處則會點破
    await egg(page).eval((e, a) => e.field!.place("triangle", a.x, a.y), spot);
    await page.mouse.click(spot.x, spot.y);
    expect((await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "triangle")!.alive).toBe(false);
    await snap(page, "background-dark.png");
  });

  test("分頁隱藏時停止繪製，回來後繼續", async ({ page }) => {
    await open(page);
    await ready(page);
    const frames = () => egg(page).eval((e) => e.field!.frames(), null);
    const f0 = await frames();
    await page.waitForTimeout(400);
    expect(await frames()).toBeGreaterThan(f0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(150);
    const a = await frames();
    await page.waitForTimeout(500);
    expect(await frames()).toBe(a);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400);
    expect(await frames()).toBeGreaterThan(a);
  });

  test("游標靠近會把符號推開（有慣性）", async ({ page }) => {
    await open(page);
    await ready(page);
    const spot = await emptySpot(page);
    await egg(page).eval((e, a) => e.field!.place("circle", a.x + 40, a.y), spot);
    const before = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "circle")!;
    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(500);
    const after = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "circle")!;
    expect(Math.hypot(after.x - spot.x, after.y - spot.y)).toBeGreaterThan(Math.hypot(before.x - spot.x, before.y - spot.y) + 20);
  });

  test("reduced-motion：背景靜止、沒有波動拳動畫，彩蛋仍可觸發", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await ready(page);
    expect(await egg(page).eval((e) => e.field!.reducedMotion, null)).toBe(true);
    const positions = () => egg(page).eval((e) => e.field!.symbols().map((s) => [s.kind, Math.round(s.x), Math.round(s.y)]), null);
    const a = await positions();
    await page.waitForTimeout(1200);
    expect(await positions()).toEqual(a);
    for (const k of ["triangle", "circle", "cross", "square"]) await breakSymbol(page, k);
    await expect(toast(page, "sony-blue")).toBeVisible();
    // 波動拳：只解鎖，不飛
    const spot = await emptySpot(page);
    await egg(page).eval((e, p) => e.field!.place("stick", p.x, p.y), spot);
    await dragStick(page, spot, ["down", "downRight", "right"]);
    await expect(toast(page, "arcade-neon")).toBeVisible();
    await expect(page.locator(".egg-hadouken")).toHaveCount(0);
  });
});

test.describe("背景符號避開內容欄", () => {
  test("寬螢幕（1900px）：只在內容欄兩側留白漂浮，不在內容欄內；自然符號可用真實滑鼠點破完成 1a", async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 900 });
    await open(page);
    await ready(page);
    await page.waitForTimeout(1500);
    const mode = await egg(page).eval((e) => e.field!.mode(), null);
    expect(mode).toEqual({ wide: true, alpha: 0.17, symbols: expect.any(Number) });
    const col = (await page.locator("main").boundingBox())!;
    const visible = (await egg(page).eval((e) => e.field!.symbols(), null)).filter((s) => s.visible && s.alive);
    expect(visible.length).toBeGreaterThanOrEqual(8);
    for (const s of visible) expect(s.ax <= col.x - 10 || s.ax >= col.x + col.width + 10, `${s.kind} 錨點 ${s.ax} 在內容欄 [${col.x}, ${col.x + col.width}] 內`).toBe(true);
    await snap(page, "background-wide-light.png");
    // 自然符號（沒有 place）：依序找可見的符號，單一 move＋click 點破
    for (const kind of ["triangle", "circle", "cross", "square"]) {
      let target: { x: number; y: number } | undefined;
      await expect
        .poll(async () => {
          const it = (await egg(page).eval((e) => e.field!.symbols(), null)).find((x) => x.kind === kind && x.visible && x.alive);
          target = it && { x: it.x, y: it.y };
          return !!it;
        }, { timeout: 12_000 })
        .toBe(true);
      await page.mouse.click(target!.x, target!.y);
    }
    await expect(toast(page, "sony-blue")).toBeVisible();
  });

  test("窄螢幕（375px 手機）：符號只有 13 顆、透明度 0.07、只出現在空白背景區、不在頁首", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await open(page);
    await ready(page);
    await page.waitForTimeout(1500);
    const mode = await egg(page).eval((e) => e.field!.mode(), null);
    expect(mode).toEqual({ wide: false, alpha: 0.07, symbols: 13 });
    const headerBottom = await page.locator(".site-header").evaluate((el) => el.getBoundingClientRect().bottom);
    const visible = (await egg(page).eval((e) => e.field!.symbols(), null)).filter((s) => s.visible && s.alive);
    expect(visible.length).toBeGreaterThanOrEqual(1);
    for (const s of visible) {
      expect(s.ay).toBeGreaterThan(headerBottom);
      expect(await egg(page).eval((e, a) => e.field!.isBackgroundAt(a.x, a.y), { x: s.ax, y: s.ay }), `${s.kind} 的錨點不是空白背景`).toBe(true);
    }
    await snap(page, "mobile-375-background.png");
  });

  test("窄螢幕（1280px）：數量不增加、透明度 0.09", async ({ page }) => {
    await open(page);
    await ready(page);
    await page.waitForTimeout(1200);
    expect(await egg(page).eval((e) => e.field!.mode(), null)).toEqual({ wide: false, alpha: 0.09, symbols: 13 });
  });

  test("每日收集物錨定在可點的空白區（手機 375px）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await open(page);
    await ready(page);
    await expect
      .poll(async () => (await egg(page).eval((e) => e.field!.symbols(), null)).some((s) => s.collectible && s.visible), { timeout: 8000 })
      .toBe(true);
    const c = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.collectible)!;
    expect(await egg(page).eval((e, a) => e.field!.isBackgroundAt(a.x, a.y), { x: c.ax, y: c.ay })).toBe(true);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator(".egg-toast[data-unlock-type=collectible]")).toBeVisible();
  });

  test("閒置聚集的手把出現在可點的空白區（手機 375px）：點那一帶的空白即解鎖", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await open(page);
    await ready(page);
    await page.waitForTimeout(800);
    await egg(page).eval((e) => e.field!.forceIdle(), null);
    await page.waitForTimeout(1200);
    const syms = (await egg(page).eval((e) => e.field!.symbols(), null)).filter((s) => s.alive && !s.collectible);
    // 聚集後符號都靠近同一個中心；在該中心附近找一個真的是空白背景的點來點
    const cx = syms.reduce((a, s) => a + s.x, 0) / syms.length;
    const cy = syms.reduce((a, s) => a + s.y, 0) / syms.length;
    let spot: { x: number; y: number } | null = null;
    for (let r = 0; r <= 120 && !spot; r += 8)
      for (let a = 0; a < 16 && !spot; a++) {
        const x = cx + r * Math.cos((a / 16) * 6.283);
        const y = cy + r * Math.sin((a / 16) * 6.283);
        if (x > 0 && y > 0 && x < 375 && y < 760 && (await egg(page).eval((e, p) => e.field!.isBackgroundAt(p.x, p.y), { x, y }))) spot = { x, y };
      }
    expect(spot, "聚集中心附近沒有可點的空白背景").not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    await expect(toast(page, "standby-purple")).toBeVisible();
  });

  test("帳號頁（已登入）：符號不在內容欄內；截圖", async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 900 });
    await signedInUser(page, "z3a-bg");
    await open(page, "/en/account");
    await ready(page);
    await page.waitForTimeout(1500);
    const col = (await page.locator("main").boundingBox())!;
    for (const s of (await egg(page).eval((e) => e.field!.symbols(), null)).filter((x) => x.visible && x.alive))
      expect(s.ax <= col.x - 10 || s.ax >= col.x + col.width + 10).toBe(true);
    await snap(page, "account-light.png");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    await snap(page, "account-dark.png");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(1500);
    await snap(page, "account-1280-light.png");
  });
});

test.describe("彩蛋 1a／1b／1c：依序點破", () => {
  const cases: [string, string[], string][] = [
    ["1a △○×□", ["triangle", "circle", "cross", "square"], "sony-blue"],
    ["1b ABXY", ["btn-a", "btn-b", "btn-x", "btn-y"], "xbox-green"],
    ["1c 十字鍵上下左右", ["dpad-up", "dpad-down", "dpad-left", "dpad-right"], "nintendo-red"],
  ];
  for (const [name, kinds, theme] of cases) {
    test(`${name} → ${theme}`, async ({ page }) => {
      await open(page);
      await ready(page);
      // 先故意點錯順序：不解鎖，且重新來過
      await breakSymbol(page, kinds[1]!);
      await breakSymbol(page, kinds[0]!);
      await page.waitForTimeout(100);
      await expect(page.locator(".egg-toast")).toHaveCount(0);
      for (const k of kinds.slice(1)) await breakSymbol(page, k);
      await expect(toast(page, theme)).toBeVisible();
      const recs = await egg(page).eval((e) => e.records(), null);
      expect(recs).toEqual([{ type: "theme", key: theme, at: expect.any(String) }]);
    });
  }

  test("被點破的符號一段時間後重生", async ({ page }) => {
    await open(page);
    await ready(page);
    await breakSymbol(page, "cross");
    const dead = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "cross")!;
    expect(dead.alive).toBe(false);
    await expect
      .poll(async () => (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.kind === "cross")!.alive, { timeout: 8000 })
      .toBe(true);
  });
});

test.describe("彩蛋 2：科納米密技", () => {
  const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  test("真實鍵盤輸入 → 8-bit；輸入過程沒有任何提示", async ({ page }) => {
    await open(page);
    for (const k of code.slice(0, -1)) {
      await page.keyboard.press(k);
      await expect(page.locator(".egg-toast")).toHaveCount(0);
    }
    await page.keyboard.press("a");
    await expect(toast(page, "eight-bit")).toBeVisible();
  });
  test("焦點在輸入框時不偵測", async ({ page }) => {
    await open(page);
    const input = page.locator("#home-search, header input[type=search], header input[role=combobox]").first();
    await input.focus();
    for (const k of code) await page.keyboard.press(k);
    await page.waitForTimeout(200);
    await expect(page.locator(".egg-toast")).toHaveCount(0);
    expect(await egg(page).eval((e) => e.records().length, null)).toBe(0);
  });
});

async function dragStick(page: Page, at: { x: number; y: number }, dirs: ("down" | "downRight" | "right")[]): Promise<void> {
  const off = { down: [0, 70], downRight: [50, 50], right: [70, 0] } as const;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (const d of dirs) await page.mouse.move(at.x + off[d][0], at.y + off[d][1], { steps: 4 });
  await page.mouse.up();
}

test.describe("彩蛋 5：蘑菇頭波動拳", () => {
  test("下 → 右下 → 右：波動拳飛過並解鎖街機霓虹", async ({ page }) => {
    await open(page);
    await ready(page);
    const spot = await emptySpot(page);
    await egg(page).eval((e, p) => e.field!.place("stick", p.x, p.y), spot);
    await dragStick(page, spot, ["down", "downRight", "right"]);
    await expect(page.locator(".egg-hadouken")).toBeVisible();
    await snap(page, "hadouken.png");
    await expect(toast(page, "arcade-neon")).toBeVisible();
    await expect(page.locator(".egg-hadouken")).toHaveCount(0, { timeout: 5000 });
  });
  test("方向錯、或中間停太久都不解鎖", async ({ page }) => {
    await open(page);
    await ready(page);
    const spot = await emptySpot(page);
    await egg(page).eval((e, p) => e.field!.place("stick", p.x, p.y), spot);
    await dragStick(page, spot, ["right", "downRight", "down"]);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, spot.y + 70, { steps: 3 });
    await page.waitForTimeout(1700);
    await page.mouse.move(spot.x + 50, spot.y + 50, { steps: 3 });
    await page.mouse.move(spot.x + 70, spot.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(page.locator(".egg-toast")).toHaveCount(0);
  });
  test("觸控（pointer events＋capture）也能拖", async ({ browser }) => {
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 700 } });
    const page = await ctx.newPage();
    await open(page);
    await ready(page);
    const spot = await emptySpot(page);
    await egg(page).eval((e, p) => e.field!.place("stick", p.x, p.y), spot);
    // 用 CDP 送觸控事件
    const cdp = await ctx.newCDPSession(page);
    const pt = (dx: number, dy: number) => [{ x: spot.x + dx, y: spot.y + dy, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(0, 0) });
    for (const [dx, dy] of [[0, 30], [0, 70], [25, 40], [50, 50], [60, 25], [70, 0]] as const) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(dx, dy) });
      await page.waitForTimeout(40);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(toast(page, "arcade-neon")).toBeVisible();
    await ctx.close();
  });
});

test.describe("彩蛋 3：每日收集物", () => {
  test("每天第一次造訪有一個發亮的收集物，點到收集；同一天重新整理不再出現", async ({ page }) => {
    await open(page);
    await ready(page);
    const items = (await egg(page).eval((e) => e.field!.symbols(), null)).filter((s) => s.collectible);
    expect(items).toHaveLength(1);
    const key = items[0]!.kind;
    expect(COLLECTIBLES).toContain(key);
    const spot = await emptySpot(page);
    await egg(page).eval((e, p) => e.field!.place("collectible", p.x, p.y), spot);
    await snap(page, "collectible.png");
    await page.mouse.click(spot.x, spot.y);
    await expect(toast(page, key)).toBeVisible();
    await page.reload();
    await ready(page);
    expect((await egg(page).eval((e) => e.field!.symbols(), null)).filter((s) => s.collectible)).toHaveLength(0);
    expect(await egg(page).eval((e) => e.records().map((r) => r.key), null)).toEqual([key]);
  });

  test("沒點到就留著：同一天重新整理看到同一種；隔天換一種未收集的", async ({ page }) => {
    await open(page);
    await ready(page);
    const first = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.collectible)!.kind;
    await page.reload();
    await ready(page);
    expect((await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.collectible)!.kind).toBe(first);
    await page.clock.setFixedTime(new Date(Date.now() + 86_400_000 * 3));
    await page.reload();
    await ready(page);
    const next = (await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.collectible);
    expect(next).toBeTruthy();
  });

  test("集滿 8 種 → 圖鑑完成金色主題（可立即套用）", async ({ page }) => {
    const seven = COLLECTIBLES.filter((k) => k !== "cloud");
    await seedUnlocks(
      page,
      seven.map((key) => ({ type: "collectible", key, at: AT })),
    );
    await open(page);
    await ready(page);
    const spot = await emptySpot(page);
    expect((await egg(page).eval((e) => e.field!.symbols(), null)).find((s) => s.collectible)!.kind).toBe("cloud");
    await egg(page).eval((e, p) => e.field!.place("collectible", p.x, p.y), spot);
    await page.mouse.click(spot.x, spot.y);
    await expect(toast(page, "cloud")).toBeVisible();
    const gold = toast(page, "gold");
    await expect(gold).toBeVisible();
    await gold.locator("[data-egg-apply]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "gold");
    expect(await page.evaluate(() => localStorage.getItem("sok-theme"))).toBe("gold");
  });
});

test.describe("彩蛋 4：閒置聚成手把", () => {
  test("閒置 → 聚集；按鍵會散開；點它解鎖待機畫面", async ({ page }) => {
    await open(page);
    await ready(page);
    await egg(page).eval((e) => e.field!.forceIdle(), null);
    expect(await egg(page).eval((e) => e.field!.isGathered(), null)).toBe(true);
    await page.keyboard.press("Shift");
    expect(await egg(page).eval((e) => e.field!.isGathered(), null)).toBe(false);
    await egg(page).eval((e) => e.field!.forceIdle(), null);
    const spot = await emptySpot(page);
    // 滑鼠移動不會散開
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    expect(await egg(page).eval((e) => e.field!.isGathered(), null)).toBe(true);
    await egg(page).eval((e, p) => e.field!.setGatherCenter(p.x, p.y), spot);
    await snap(page, "gather.png");
    await page.mouse.click(spot.x, spot.y);
    await expect(toast(page, "standby-purple")).toBeVisible();
    expect(await egg(page).eval((e) => e.field!.isGathered(), null)).toBe(false);
  });
});

test.describe("彩蛋 6：夜貓子", () => {
  test("本地 02:00～03:59 造訪 → 解鎖；白天不會", async ({ browser }) => {
    for (const [iso, expected] of [
      ["2026-10-23T02:30:00Z", true],
      ["2026-10-23T03:59:00Z", true],
      ["2026-10-23T04:00:00Z", false],
      ["2026-10-23T12:00:00Z", false],
    ] as const) {
      const ctx = await browser.newContext({ timezoneId: "UTC" });
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(iso));
      await open(page);
      if (expected) await expect(toast(page, "night-owl")).toBeVisible();
      else {
        await page.waitForTimeout(400);
        await expect(page.locator(".egg-toast")).toHaveCount(0);
      }
      await ctx.close();
    }
  });
  test("時區用使用者本地時間", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "Asia/Taipei" });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2026-10-22T18:30:00Z")); // 台北 02:30
    await open(page);
    await expect(toast(page, "night-owl")).toBeVisible();
    await ctx.close();
  });
});

test.describe("彩蛋 8：連點 header 品牌文字", () => {
  async function brandClicks(page: Page, n: number, gapMs = 0): Promise<void> {
    const box = (await page.locator("[data-site-brand]").boundingBox())!;
    for (let i = 0; i < n; i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (gapMs) await page.waitForTimeout(gapMs);
    }
  }
  test("首頁 2 秒內 10 次 → Coding（沒有重新載入、沒有導覽）", async ({ page }) => {
    await open(page, "/en");
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    await brandClicks(page, 10);
    await expect(toast(page, "coding")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  });
  test("其他頁：點品牌立即前往首頁（無延遲），連點不計數", async ({ page }) => {
    await open(page, "/en/subscribe");
    const t0 = Date.now();
    await page.locator("[data-site-brand]").click();
    await page.waitForURL((u) => ["/en", "/en/"].includes(u.pathname), { timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(2000);
    // 連點也不會計數（每次都是立即導覽）
    await open(page, "/en/subscribe");
    await page.locator("[data-site-brand]").click();
    await page.waitForURL((u) => ["/en", "/en/"].includes(u.pathname));
    await expect(page.locator(".egg-toast")).toHaveCount(0);
  });
  test("太慢（超過 2 秒窗口）不成立", async ({ page }) => {
    await open(page, "/en");
    await brandClicks(page, 10, 260);
    await page.waitForTimeout(200);
    await expect(page.locator(".egg-toast")).toHaveCount(0);
  });
});

test.describe("彩蛋 7：成就（瀏覽器端）與全成就彩虹框線", () => {
  test("看過 50 款遊戲（同一款只算一次）", async ({ page }) => {
    const seen = Array.from({ length: 49 }, (_, i) => `seen-${i}`);
    await page.addInitScript((list) => localStorage.setItem("sok-egg-viewed", JSON.stringify(list)), seen);
    await open(page, `/en/games/${FIXTURE.hero.slug}`);
    await expect(toast(page, "viewed-50-games")).toBeVisible();
    // 再看同一款不會重複計數
    await page.reload();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sok-egg-viewed")))!)).toHaveLength(50);
  });
  test("同一款重複瀏覽不累計", async ({ page }) => {
    await open(page, `/en/games/${FIXTURE.hero.slug}`);
    await page.reload();
    await page.reload();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sok-egg-viewed")))!)).toEqual([FIXTURE.hero.slug]);
  });
  test("第一次訂閱 iCal（訂閱頁按下複製）", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "/en/subscribe");
    await page.locator('[data-feed] [data-action="copy"]').first().click();
    await expect(toast(page, "first-ical-subscribe")).toBeVisible();
  });
  test("其餘成就全達成 → 全成就＋header 帳號按鈕彩虹框線", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedUnlocks(
      page,
      ["viewed-50-games", "first-follow", "first-list"].map((key) => ({ type: "achievement", key, at: AT })),
    );
    await open(page, "/en/subscribe");
    await page.locator('[data-feed] [data-action="copy"]').first().click();
    await expect(toast(page, "first-ical-subscribe")).toBeVisible();
    await expect(toast(page, "all-achievements")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-all-achievements", "true");
    const bg = await headerMenu(page, "account").trigger.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("linear-gradient");
    await snap(page, "rainbow-frame.png", { x: 0, y: 0, width: 1280, height: 120 });
    // 重新整理後仍在
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-all-achievements", "true");
  });
});

test.describe("解鎖提示", () => {
  test("aria-live、從右緣滑入（ease-out 220ms）、可關閉、自動消失、懸停暫停、Esc 關閉", async ({ page }) => {
    await open(page);
    const region = page.locator("[data-egg-toasts]");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await egg(page).eval((e) => e.unlock("theme", "gold"), null);
    const t = toast(page, "gold");
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute("data-state", "in");
    const trans = await t.evaluate((el) => {
      const s = getComputedStyle(el);
      return { dur: s.transitionDuration, prop: s.transitionProperty };
    });
    expect(trans.prop).toContain("transform");
    expect(trans.dur).toContain("0.22s");
    await page.waitForTimeout(350);
    await snap(page, "unlock-toast.png");
    // 關閉鈕
    await t.locator("[data-egg-close]").click();
    await expect(t).toHaveCount(0);
    // Esc（焦點在提示內）
    await egg(page).eval((e) => e.unlock("theme", "coding"), null);
    const t2 = toast(page, "coding");
    await t2.locator("[data-egg-close]").focus();
    await page.keyboard.press("Escape");
    await expect(t2).toHaveCount(0);
  });
  test("幾秒後自動消失；滑鼠移上去暫停計時", async ({ page }) => {
    await open(page);
    await egg(page).eval((e) => e.unlock("theme", "night-owl"), null);
    const t = toast(page, "night-owl");
    await expect(t).toBeVisible();
    await t.hover();
    await page.waitForTimeout(7500);
    await expect(t).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(t).toHaveCount(0, { timeout: 12_000 });
  });
  test("320px：提示不溢出、頁面不水平捲動", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await egg(page).eval((e) => e.unlock("theme", "eight-bit"), null);
    const t = toast(page, "eight-bit");
    await expect(t).toBeVisible();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const r = document.querySelector(".egg-toast")!.getBoundingClientRect();
      return { left: r.left, right: r.right, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.iw);
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    await snap(page, "mobile-320-toast.png");
  });
  test("手機 375px 截圖（已解鎖主題、背景）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await seedUnlocks(page, themeRecs(["coding"]), "coding");
    await open(page);
    await ready(page);
    await snap(page, "mobile-375-coding.png");
  });
});

test.describe("同步器（登入後由 accounts 掛上）", () => {
  test("掛上時把本機紀錄 push 上去，回來的清單寫回；之後的解鎖也會 push；失敗留在本機", async ({ page }) => {
    await open(page);
    await egg(page).eval((e) => e.unlock("theme", "gold"), null);
    await page.evaluate(() => {
      const w = window as unknown as { __pushes: Rec[][]; __eggTest: Egg };
      w.__pushes = [];
      w.__eggTest.registerSync({
        push: async (local) => {
          w.__pushes.push(local);
          return [...local, { type: "theme", key: "coding", at: "2026-10-01T00:00:00.000Z" }];
        },
      });
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pushes: Rec[][] }).__pushes.length)).toBeGreaterThan(0);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("sok-unlocks")!).map((r: Rec) => r.key).sort());
    await expect.poll(stored).toEqual(["coding", "gold"]);
    // 同步來的主題進了選單（沒有解鎖提示）
    await expect(page.locator(".egg-toast[data-unlock-key=coding]")).toHaveCount(0);
    const panel = await openHeaderMenu(page, "theme");
    await expect(panel.locator('[data-theme-option="coding"]')).toBeAttached();
    // 之後的解鎖也 push
    await egg(page).eval((e) => e.unlock("theme", "night-owl"), null);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pushes: Rec[][] }).__pushes.at(-1)!.map((r) => r.key).sort())).toContain("night-owl");
    // 失敗：留在本機
    await page.evaluate(() => {
      (window as unknown as { __eggTest: Egg }).__eggTest.registerSync({
        push: async () => {
          throw new Error("offline");
        },
      });
    });
    await egg(page).eval((e) => e.unlock("theme", "eight-bit"), null);
    await page.waitForTimeout(200);
    await expect.poll(stored).toContain("eight-bit");
  });
});

test.describe("隱藏主題", () => {
  test("未解鎖：選單不顯示；localStorage 硬塞也不套用（退回系統）", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sok-theme", "coding"));
    await open(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const panel = await openHeaderMenu(page, "theme");
    await expect(panel.locator("[data-theme-option]")).toHaveCount(3);
  });

  test("解鎖後出現在選單、選了會套用、重新整理後保留、首次繪製前就套用", async ({ page }) => {
    await seedUnlocks(page, themeRecs(THEMES));
    await open(page);
    const panel = await openHeaderMenu(page, "theme");
    await expect(panel.locator("[data-theme-option]")).toHaveCount(12);
    await snap(page, "theme-dropdown-unlocked.png");
    await panel.getByRole("button", { name: msg("en", "ui.theme.gold") }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "gold");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "gold");
    // 首次繪製前：inline script 已經設好屬性
    const early = await page.evaluate(async () => {
      const res = await fetch(location.href);
      return (await res.text()).includes("data-theme=");
    });
    expect(early).toBe(false); // 伺服器 HTML 與使用者無關
    await page.goto("/en/about/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "gold");
  });

  test("切換有短 crossfade（只轉場色彩屬性、≤200ms）；reduced-motion 直接切換", async ({ page }) => {
    await seedUnlocks(page, themeRecs(THEMES));
    await open(page);
    const panel = await openHeaderMenu(page, "theme");
    await page.evaluate(() => {
      const w = window as unknown as { __fade: { prop: string; dur: string } | null };
      w.__fade = null;
      new MutationObserver(() => {
        if (document.documentElement.classList.contains("theme-fade") && !w.__fade) {
          const st = getComputedStyle(document.body);
          w.__fade = { prop: st.transitionProperty, dur: st.transitionDuration };
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    });
    await panel.getByRole("button", { name: msg("en", "ui.theme.crimson") }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fade: unknown }).__fade)).not.toBeNull();
    const fade = (await page.evaluate(() => (window as unknown as { __fade: { prop: string; dur: string } }).__fade))!;
    expect(fade.prop).not.toContain("all");
    expect(fade.prop).toContain("background-color");
    for (const d of fade.dur.split(",")) expect(parseFloat(d)).toBeLessThanOrEqual(0.2);
    await expect(page.locator("html")).not.toHaveClass(/theme-fade/, { timeout: 2000 });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const panel2 = await openHeaderMenu(page, "theme");
    await panel2.getByRole("button", { name: msg("en", "ui.theme.coding") }).click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("theme-fade"))).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "coding");
  });

  for (const theme of THEMES) {
    test(`${theme}：首頁與月曆 axe 通過（WCAG AA）、320px 無溢出`, async ({ page }) => {
      await seedUnlocks(page, themeRecs(THEMES), theme);
      await open(page, "/en");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await ready(page);
      await expectNoA11yViolations(page, `${theme} 首頁`);
      await snap(page, `theme-${theme}.png`);
      await page.goto(`/en/calendar/${FIXTURE.month}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoA11yViolations(page, `${theme} 月曆`);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/en");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(over).toBeLessThanOrEqual(0);
    });
  }

  test("三語系字典都有隱藏主題名稱", async () => {
    for (const locale of LOCALES as readonly TestLocale[])
      for (const t of THEMES) expect(msg(locale, `ui.theme.${THEME_LABEL[t]}`).length).toBeGreaterThan(0);
  });
});
