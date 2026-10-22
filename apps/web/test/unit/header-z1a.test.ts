/**
 * Z1A 單元測試：主題偏好的讀寫與套用、下拉的方向鍵規則、搜尋候選 combobox 的鍵盤狀態機、導覽「目前頁」判斷。
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { nextDropdownIndex } from "@/kernel/ui/dropdown-keys";
import {
  THEME_INIT_SCRIPT,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  readTheme,
  visibleThemeOptions,
  writeTheme,
} from "@/kernel/ui/theme";
import { COMBO_CLOSED, comboKeyDown } from "@/modules/catalog/ui/search/combobox-state";
import { brandOfPath, isCurrentNav, navItems, stripLocalePrefix } from "@/modules/catalog/ui/layout/nav-items";
import { searchBoxLabels } from "@/modules/catalog/ui/search/labels";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  };
}

describe("主題偏好（kernel/ui/theme）", () => {
  it("預設是系統；不認得的值一律當系統", () => {
    expect(readTheme(fakeStorage())).toBe("system");
    expect(readTheme(fakeStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("system");
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme(42)).toBe("system");
  });
  it("寫入後讀得回來；寫「系統」＝移除這個鍵", () => {
    const st = fakeStorage();
    expect(writeTheme("dark", st)).toBe(true);
    expect(st.data.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readTheme(st)).toBe("dark");
    writeTheme("light", st);
    expect(readTheme(st)).toBe("light");
    writeTheme("system", st);
    expect(st.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readTheme(st)).toBe("system");
  });
  it("儲存空間丟錯（私密視窗、封鎖）→ 讀退回系統、寫回傳 false，不丟例外", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTheme(broken)).toBe("system");
    expect(writeTheme("dark", broken)).toBe(false);
    expect(readTheme(null)).toBe("system");
    expect(writeTheme("dark", null)).toBe(false);
  });
  it("套到 <html>：亮／暗設 data-theme，系統移除屬性", () => {
    const root = fakeRoot();
    applyTheme("dark", root);
    expect(root.attrs.get("data-theme")).toBe("dark");
    applyTheme("light", root);
    expect(root.attrs.get("data-theme")).toBe("light");
    applyTheme("system", root);
    expect(root.attrs.has("data-theme")).toBe(false);
    applyTheme("whatever", root);
    expect(root.attrs.has("data-theme")).toBe(false);
  });
  it("選項清單：預設三個都顯示；locked 的隱藏主題不出現在選單", () => {
    expect(visibleThemeOptions().map((o) => o.id)).toEqual(["system", "light", "dark"]);
    expect(visibleThemeOptions([...THEME_OPTIONS, { id: "secret", labelKey: "secret", locked: true }]).map((o) => o.id)).toEqual(["system", "light", "dark"]);
  });
  it("<head> inline script 和 readTheme 同一套規則（只認 light／dark），並包 try/catch", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("try{");
    const run = (stored: string | null) => {
      const root = fakeRoot();
      const doc = { documentElement: root };
      new Function("localStorage", "document", THEME_INIT_SCRIPT)({ getItem: () => stored }, doc);
      return root.attrs.get("data-theme");
    };
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
    expect(run("system")).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(() => new Function("localStorage", "document", THEME_INIT_SCRIPT)({ getItem: () => { throw new Error("x"); } }, { documentElement: fakeRoot() })).not.toThrow();
  });
  it("三語都有主題選單的字典", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const t = createTranslator(locale);
      expect(t.t("ui.theme.menuLabel")).not.toBe("ui.theme.menuLabel");
      for (const o of THEME_OPTIONS) expect(t.t(`ui.theme.${o.labelKey}`), `${locale} ${o.id}`).not.toContain("ui.theme.");
    }
  });
});

describe("下拉的方向鍵規則", () => {
  it("↓↑ 繞回、Home／End 跳頭尾、焦點在按鈕上（-1）按 ↓ 到第一項、按 ↑ 到最後一項", () => {
    expect(nextDropdownIndex("ArrowDown", -1, 4)).toBe(0);
    expect(nextDropdownIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextDropdownIndex("ArrowDown", 1, 4)).toBe(2);
    expect(nextDropdownIndex("ArrowUp", 0, 4)).toBe(3);
    expect(nextDropdownIndex("ArrowUp", -1, 4)).toBe(3);
    expect(nextDropdownIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextDropdownIndex("Home", 2, 4)).toBe(0);
    expect(nextDropdownIndex("End", 0, 4)).toBe(3);
  });
  it("沒有項目或其他按鍵不處理", () => {
    expect(nextDropdownIndex("ArrowDown", -1, 0)).toBeNull();
    expect(nextDropdownIndex("a", 0, 4)).toBeNull();
    expect(nextDropdownIndex("Tab", 0, 4)).toBeNull();
  });
});

describe("搜尋候選 combobox 鍵盤狀態機", () => {
  const ctx = { count: 4, value: "ze" }; // 3 筆候選 + 查看全部
  it("清單關閉時 ↓ 開啟並選第一項、↑ 開啟並選最後一項", () => {
    expect(comboKeyDown(COMBO_CLOSED, "ArrowDown", ctx)).toMatchObject({ state: { open: true, active: 0 }, handled: true });
    expect(comboKeyDown(COMBO_CLOSED, "ArrowUp", ctx)).toMatchObject({ state: { open: true, active: 3 }, handled: true });
  });
  it("開啟時 ↓↑ 移動並繞回（含最後一列「查看全部」）", () => {
    let s = comboKeyDown({ open: true, active: -1 }, "ArrowDown", ctx).state;
    expect(s.active).toBe(0);
    s = comboKeyDown(s, "ArrowDown", ctx).state;
    s = comboKeyDown(s, "ArrowDown", ctx).state;
    s = comboKeyDown(s, "ArrowDown", ctx).state;
    expect(s.active).toBe(3);
    expect(comboKeyDown(s, "ArrowDown", ctx).state.active).toBe(0);
    expect(comboKeyDown({ open: true, active: 0 }, "ArrowUp", ctx).state.active).toBe(3);
  });
  it("沒有任何項目時方向鍵不處理（讓游標照常移動）", () => {
    expect(comboKeyDown(COMBO_CLOSED, "ArrowDown", { count: 0, value: "x" }).handled).toBe(false);
  });
  it("Enter：有選中項才進入該項；沒選中不處理＝表單照常送出", () => {
    expect(comboKeyDown({ open: true, active: 2 }, "Enter", ctx)).toMatchObject({ handled: true, select: true });
    expect(comboKeyDown({ open: true, active: -1 }, "Enter", ctx)).toMatchObject({ handled: false, select: false });
    expect(comboKeyDown({ open: false, active: 1 }, "Enter", ctx)).toMatchObject({ handled: false, select: false });
  });
  it("Esc：先關清單；清單已關且有字才清空；都沒有就不處理（外層可據此收起搜尋列）", () => {
    expect(comboKeyDown({ open: true, active: 1 }, "Escape", ctx)).toMatchObject({ state: COMBO_CLOSED, handled: true, clear: false });
    expect(comboKeyDown(COMBO_CLOSED, "Escape", ctx)).toMatchObject({ handled: true, clear: true });
    expect(comboKeyDown(COMBO_CLOSED, "Escape", { count: 0, value: "" })).toMatchObject({ handled: false, clear: false });
  });
  it("Tab 關閉清單但不攔截", () => {
    const r = comboKeyDown({ open: true, active: 1 }, "Tab", ctx);
    expect(r.state).toEqual(COMBO_CLOSED);
    expect(r.handled).toBe(false);
  });
  it("一般字元不處理", () => {
    expect(comboKeyDown({ open: true, active: 1 }, "a", ctx)).toMatchObject({ handled: false, state: { open: true, active: 1 } });
  });
});

describe("導覽下拉", () => {
  const t = createTranslator("en");
  const items = navItems("en", t);
  const current = (path: string) => items.filter((i) => isCurrentNav(i, path)).map((i) => i.path);
  it("項目是單一陣列，順序為首頁、月曆、時間軸、熱門榜、遊戲、平台、活動、評分，各帶品牌名", () => {
    expect(items.map((i) => i.path)).toEqual(["/", "/calendar", "/timeline", "/trending", "/games", "/platforms", "/events", "/ratings"]);
    expect(items.map((i) => i.brand)).toEqual(["GameDex", "GameCalendar", "GameTimeline", "GameTrend", "GameBase", "GamePlat", "GameEvent", "GameRanking"]);
    expect(items[0]!.href).toBe("/en");
  });
  it("header 品牌文字：依路徑所屬區塊；子頁面跟隨區塊；其餘用 GameDex", () => {
    expect(brandOfPath("/")).toBe("GameDex");
    expect(brandOfPath("/calendar/2026-10")).toBe("GameCalendar");
    expect(brandOfPath("/timeline")).toBe("GameTimeline");
    expect(brandOfPath("/trending")).toBe("GameTrend");
    expect(brandOfPath("/games")).toBe("GameBase");
    expect(brandOfPath("/games/elden-ring")).toBe("GameBase");
    expect(brandOfPath("/companies/fromsoftware")).toBe("GameBase");
    expect(brandOfPath("/franchises/zelda")).toBe("GameBase");
    expect(brandOfPath("/platforms/ps5")).toBe("GamePlat");
    expect(brandOfPath("/events/e3")).toBe("GameEvent");
    expect(brandOfPath("/ratings")).toBe("GameRanking");
    expect(brandOfPath("/account/lists")).toBe("GameDex");
    expect(brandOfPath("/about/privacy")).toBe("GameDex");
    expect(brandOfPath("/subscribe")).toBe("GameDex");
  });
  it("目前頁：首頁只有 / ；/games 不含詳情；其餘依路徑前綴", () => {
    expect(current("/")).toEqual(["/"]);
    expect(current("/calendar/2026-10")).toEqual(["/calendar"]);
    expect(current("/games")).toEqual(["/games"]);
    expect(current("/games/elden-ring")).toEqual([]);
    expect(current("/platforms/ps5")).toEqual(["/platforms"]);
    expect(current("/events/e3")).toEqual(["/events"]);
    expect(current("/account")).toEqual([]);
  });
  it("由 pathname 去掉語系前綴", () => {
    expect(stripLocalePrefix("/en/calendar/2026-10")).toBe("/calendar/2026-10");
    expect(stripLocalePrefix("/zh-Hant")).toBe("/");
    expect(stripLocalePrefix("/ja/account/lists")).toBe("/account/lists");
  });
  it("搜尋框字串三語齊全（含 {n} 保留給客戶端）", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const labels = searchBoxLabels(createTranslator(locale));
      expect(labels.count, locale).toContain("{n}");
      for (const v of Object.values(labels)) expect(v, locale).not.toMatch(/^ui\./);
    }
  });
});
