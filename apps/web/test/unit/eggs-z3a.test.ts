import { describe, expect, it, vi } from "vitest";
import {
  HADOUKEN_WINDOW_MS,
  createClickCounter,
  createHadoukenTracker,
  createIdleTracker,
  createKonamiTracker,
  createSequenceTracker,
  dailyStateFor,
  gameSlugFromPath,
  hasAllCollectibles,
  isNightOwlHour,
  isTypingTarget,
  localDateKey,
  othersAchieved,
  parseDaily,
  parseViewed,
  pickDailyCollectible,
  quantizeStick,
  recordViewedGame,
} from "@/kernel/ui/eggs/logic";
import { isBackgroundTarget, type NodeInfo } from "@/kernel/ui/eggs/bg-target";
import { createUnlockStore, parseUnlocks, UNLOCKS_STORAGE_KEY, type UnlockStorage } from "@/kernel/ui/unlock-store";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, normalizeTheme, readTheme, themeOptionsFor, writeTheme } from "@/kernel/ui/theme";
import { UNLOCK_COLLECTIBLE_KEYS, UNLOCK_THEME_KEYS, type UnlockRecord } from "@/kernel/ui/unlocks";

describe("依序點破（彩蛋 1a／1b／1c）", () => {
  it("△○×□ 依序完成；順序錯就重來", () => {
    const t = createSequenceTracker();
    expect(t.hit("triangle")).toEqual([]);
    expect(t.hit("cross")).toEqual([]); // 錯：重來
    expect(t.hit("circle")).toEqual([]);
    expect(t.hit("triangle")).toEqual([]); // 錯的那顆是第一顆 → 算第 1 步
    expect(t.hit("circle")).toEqual([]);
    expect(t.hit("cross")).toEqual([]);
    const done = t.hit("square");
    expect(done.map((s) => s.unlock.key)).toEqual(["sony-blue"]);
    expect(t.progress("shapes")).toBe(0);
  });
  it("ABXY、十字鍵四向各自獨立追蹤", () => {
    const t = createSequenceTracker();
    for (const k of ["btn-a", "btn-b", "btn-x"] as const) expect(t.hit(k)).toEqual([]);
    expect(t.hit("btn-y").map((s) => s.unlock.key)).toEqual(["xbox-green"]);
    for (const k of ["dpad-up", "dpad-down", "dpad-left"] as const) expect(t.hit(k)).toEqual([]);
    expect(t.hit("dpad-right").map((s) => s.unlock.key)).toEqual(["nintendo-red"]);
  });
  it("點到別的序列的符號會重置本序列的進度", () => {
    const t = createSequenceTracker();
    t.hit("triangle");
    t.hit("btn-a");
    expect(t.progress("shapes")).toBe(0);
    expect(t.progress("buttons")).toBe(1);
  });
});

describe("科納米密技（彩蛋 2）", () => {
  const seq = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];
  it("完整輸入成立", () => {
    const k = createKonamiTracker();
    const results = seq.map((c) => k.key(c));
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });
  it("前面有多餘按鍵或重複 ↑ 仍成立；缺一個不成立", () => {
    const k = createKonamiTracker();
    for (const c of ["KeyZ", "ArrowUp", ...seq.slice(0, -1)]) expect(k.key(c)).toBe(false);
    expect(k.key("KeyA")).toBe(true);
    const k2 = createKonamiTracker();
    const bad = seq.filter((_, i) => i !== 3).map((c) => k2.key(c));
    expect(bad.some(Boolean)).toBe(false);
  });
  it("輸入元件有焦點時不偵測", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("波動拳（彩蛋 5）", () => {
  it("quantizeStick：八方向、回中", () => {
    expect(quantizeStick(0, 30, 40)).toBe("down");
    expect(quantizeStick(25, 25, 40)).toBe("downRight");
    expect(quantizeStick(35, 0, 40)).toBe("right");
    expect(quantizeStick(-35, 0, 40)).toBe("left");
    expect(quantizeStick(0, -35, 40)).toBe("up");
    expect(quantizeStick(5, 5, 40)).toBeNull(); // 位移太小
    expect(quantizeStick(30, 5, 40)).toBe("right"); // 角度容許誤差
    expect(quantizeStick(1, 1, 0)).toBeNull();
  });
  it("下 → 右下 → 右 在時間窗內成立", () => {
    const h = createHadoukenTracker();
    expect(h.push("down", 0)).toBe(false);
    expect(h.push("down", 100)).toBe(false); // 重複忽略
    expect(h.push(null, 200)).toBe(false); // 回中忽略
    expect(h.push("downRight", 600)).toBe(false);
    expect(h.push("right", 1200)).toBe(true);
  });
  it("超過 1.5 秒、方向錯都重來", () => {
    const h = createHadoukenTracker();
    h.push("down", 0);
    h.push("downRight", 700);
    expect(h.push("right", HADOUKEN_WINDOW_MS + 1)).toBe(false);
    const h2 = createHadoukenTracker();
    h2.push("down", 0);
    expect(h2.push("right", 100)).toBe(false); // 跳過右下
    expect(h2.push("downRight", 200)).toBe(false);
    const h3 = createHadoukenTracker();
    h3.push("down", 0);
    h3.push("left", 100);
    h3.push("down", 200); // 重新開始
    h3.push("downRight", 300);
    expect(h3.push("right", 400)).toBe(true);
  });
});

describe("連點計數（彩蛋 8）", () => {
  it("2 秒內 10 次成立並清空", () => {
    const c = createClickCounter(10, 2000);
    let hit = false;
    for (let i = 0; i < 10; i++) hit = c.click(i * 150);
    expect(hit).toBe(true);
    expect(c.count(1500)).toBe(0);
  });
  it("太慢不成立", () => {
    const c = createClickCounter(10, 2000);
    let any = false;
    for (let i = 0; i < 20; i++) any = c.click(i * 300) || any;
    expect(any).toBe(false);
  });
});

describe("閒置偵測（彩蛋 4）", () => {
  function fake() {
    let t = 0;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let nid = 1;
    return {
      sched: {
        now: () => t,
        setTimeout: (fn: () => void, ms: number) => {
          const id = nid++;
          timers.push({ at: t + ms, fn, id });
          return id;
        },
        clearTimeout: (h: unknown) => {
          const i = timers.findIndex((x) => x.id === h);
          if (i >= 0) timers.splice(i, 1);
        },
      },
      advance(ms: number) {
        const end = t + ms;
        for (;;) {
          timers.sort((a, b) => a.at - b.at);
          const next = timers[0];
          if (!next || next.at > end) break;
          timers.shift();
          t = next.at;
          next.fn();
        }
        t = end;
      },
    };
  }
  it("60 秒無活動才觸發一次", () => {
    const f = fake();
    const onIdle = vi.fn();
    const idle = createIdleTracker(60_000, onIdle, f.sched);
    idle.start();
    f.advance(59_000);
    expect(onIdle).not.toHaveBeenCalled();
    f.advance(2_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    f.advance(120_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
  it("活動會重新計時；觸發後有活動可再次閒置", () => {
    const f = fake();
    const onIdle = vi.fn();
    const idle = createIdleTracker(60_000, onIdle, f.sched);
    idle.start();
    f.advance(50_000);
    idle.activity();
    f.advance(50_000);
    expect(onIdle).not.toHaveBeenCalled();
    f.advance(11_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    idle.activity();
    f.advance(61_000);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });
  it("stop 之後不觸發", () => {
    const f = fake();
    const onIdle = vi.fn();
    const idle = createIdleTracker(1000, onIdle, f.sched);
    idle.start();
    idle.stop();
    f.advance(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe("每日收集物（彩蛋 3）", () => {
  it("決定性：同日期＋同已收集清單 → 同結果，且只挑未收集的", () => {
    const a = pickDailyCollectible("2026-10-23", []);
    expect(pickDailyCollectible("2026-10-23", [])).toBe(a);
    const collected = UNLOCK_COLLECTIBLE_KEYS.filter((k) => k !== "cloud");
    expect(pickDailyCollectible("2026-10-24", collected)).toBe("cloud");
    expect(pickDailyCollectible("2026-10-24", [...UNLOCK_COLLECTIBLE_KEYS])).toBeNull();
  });
  it("不同日期會輪到不同種類", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 60; d++) seen.add(pickDailyCollectible(`2026-11-${String(d).padStart(2, "0")}`, [])!);
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
  it("同一天沿用已存的；隔天重挑；已收集的標記 found；全收集完不放", () => {
    const s = { date: "2026-10-23", key: "dvd" as const, found: false };
    expect(dailyStateFor("2026-10-23", s, [])).toEqual(s);
    expect(dailyStateFor("2026-10-23", s, ["dvd"])).toEqual({ ...s, found: true });
    const next = dailyStateFor("2026-10-24", s, ["dvd"]);
    expect(next?.date).toBe("2026-10-24");
    expect(next?.key).not.toBe("dvd");
    expect(dailyStateFor("2026-10-24", s, [...UNLOCK_COLLECTIBLE_KEYS])).toBeNull();
  });
  it("parseDaily 與 localDateKey", () => {
    expect(parseDaily('{"date":"2026-10-23","key":"cd","found":true}')).toEqual({ date: "2026-10-23", key: "cd", found: true });
    expect(parseDaily('{"date":"x","key":"nope","found":true}')).toBeNull();
    expect(parseDaily("{bad")).toBeNull();
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("夜貓子、瀏覽計數、成就彙整", () => {
  it("02:00～03:59 本地時間", () => {
    expect(isNightOwlHour(new Date(2026, 9, 23, 1, 59))).toBe(false);
    expect(isNightOwlHour(new Date(2026, 9, 23, 2, 0))).toBe(true);
    expect(isNightOwlHour(new Date(2026, 9, 23, 3, 59))).toBe(true);
    expect(isNightOwlHour(new Date(2026, 9, 23, 4, 0))).toBe(false);
  });
  it("同一款只算一次，第 50 款達標，之後不再增長", () => {
    let list: string[] = [];
    let reached = false;
    for (let i = 0; i < 49; i++) ({ list, reached } = recordViewedGame(list, `g${i}`));
    expect(reached).toBe(false);
    ({ list, reached } = recordViewedGame(list, "g0"));
    expect(list).toHaveLength(49);
    ({ list, reached } = recordViewedGame(list, "g49"));
    expect(list).toHaveLength(50);
    expect(reached).toBe(true);
    ({ list } = recordViewedGame(list, "g50"));
    expect(list).toHaveLength(50);
    expect(parseViewed("not json")).toEqual([]);
    expect(parseViewed('["a",1,"b"]')).toEqual(["a", "b"]);
  });
  it("遊戲詳情路徑", () => {
    expect(gameSlugFromPath("/zh-Hant/games/elden-ring")).toBe("elden-ring");
    expect(gameSlugFromPath("/en/games/elden-ring/")).toBe("elden-ring");
    expect(gameSlugFromPath("/en/games")).toBeNull();
    expect(gameSlugFromPath("/en/platforms/pc")).toBeNull();
  });
  it("集滿 8 種／其餘成就全達成", () => {
    const at = "2026-10-23T00:00:00.000Z";
    const col: UnlockRecord[] = UNLOCK_COLLECTIBLE_KEYS.map((key) => ({ type: "collectible", key, at }));
    expect(hasAllCollectibles(col)).toBe(true);
    expect(hasAllCollectibles(col.slice(1))).toBe(false);
    const ach = ["viewed-50-games", "first-ical-subscribe", "first-follow", "first-list"].map((key) => ({ type: "achievement" as const, key, at }));
    expect(othersAchieved(ach)).toBe(true);
    expect(othersAchieved(ach.slice(1))).toBe(false);
  });
});

describe("空白背景判定", () => {
  const n = (over: Partial<NodeInfo> & { tag: string }, parent: NodeInfo | null = null): NodeInfo => ({
    parent,
    hasOwnText: false,
    interactive: false,
    opaque: false,
    ...over,
  });
  const html = n({ tag: "HTML" });
  const body = n({ tag: "BODY", opaque: true }, html);
  it("html／body 直接點到＝空白", () => {
    expect(isBackgroundTarget(html)).toBe(true);
    expect(isBackgroundTarget(body)).toBe(true);
  });
  it("透明容器＝空白；有文字、可互動、媒體、實色背景（含祖先）＝內容", () => {
    const wrap = n({ tag: "DIV" }, body);
    const main = n({ tag: "MAIN" }, wrap);
    expect(isBackgroundTarget(main)).toBe(true);
    expect(isBackgroundTarget(n({ tag: "P", hasOwnText: true }, main))).toBe(false);
    expect(isBackgroundTarget(n({ tag: "SPAN", interactive: true }, main))).toBe(false);
    expect(isBackgroundTarget(n({ tag: "IMG" }, main))).toBe(false);
    const card = n({ tag: "DIV", opaque: true }, main);
    expect(isBackgroundTarget(n({ tag: "DIV" }, card))).toBe(false);
    expect(isBackgroundTarget(null)).toBe(false);
  });
});

function memStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  } satisfies UnlockStorage & { data: Record<string, string>; removeItem(k: string): void };
}

describe("解鎖儲存與同步", () => {
  const fixed = () => new Date("2026-10-23T10:00:00Z");
  it("unlock 寫入 localStorage、通知訂閱者與 onUnlock；重複不通知", () => {
    const st = memStorage();
    const store = createUnlockStore({ storage: st, now: fixed });
    const sub = vi.fn();
    const onUnlock = vi.fn();
    store.subscribe(sub);
    store.onUnlock(onUnlock);
    expect(store.unlock("theme", "gold")).toBe(true);
    expect(store.unlock("theme", "gold")).toBe(false);
    expect(sub).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(parseUnlocks(st.data[UNLOCKS_STORAGE_KEY])).toEqual([{ type: "theme", key: "gold", at: "2026-10-23T10:00:00.000Z" }]);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
  it("不認得的 key 不寫入；壞資料當空", () => {
    const store = createUnlockStore({ storage: memStorage({ [UNLOCKS_STORAGE_KEY]: "{oops" }), now: fixed });
    expect(store.getSnapshot()).toEqual([]);
    expect(store.unlock("theme", "not-a-theme")).toBe(false);
  });
  it("沒有儲存空間也能運作（只在記憶體）", () => {
    const store = createUnlockStore({ storage: null, now: fixed });
    expect(store.unlock("collectible", "cd")).toBe(true);
    expect(store.getSnapshot()).toHaveLength(1);
  });
  it("有同步器：push 本機整份，回來的完整清單合併寫回（不算新解鎖）；失敗留在本機", async () => {
    const st = memStorage();
    const remote: UnlockRecord = { type: "theme", key: "coding", at: "2026-10-01T00:00:00.000Z" };
    const push = vi.fn(async (local: readonly UnlockRecord[]) => [...local, remote]);
    const store = createUnlockStore({ storage: st, now: fixed, getSync: () => ({ push }) });
    const onUnlock = vi.fn();
    store.onUnlock(onUnlock);
    store.unlock("theme", "gold");
    await store.syncNow();
    expect(push).toHaveBeenCalled();
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().map((r) => r.key).sort()).toEqual(["coding", "gold"]);
    expect(parseUnlocks(st.data[UNLOCKS_STORAGE_KEY])).toHaveLength(2);

    const failing = createUnlockStore({
      storage: memStorage(),
      now: fixed,
      getSync: () => ({
        push: async () => {
          throw new Error("offline");
        },
      }),
    });
    failing.unlock("theme", "gold");
    await failing.syncNow();
    expect(failing.getSnapshot()).toHaveLength(1);
  });
  it("同一 type＋key 合併時留較早的時間", () => {
    const store = createUnlockStore({ storage: memStorage(), now: fixed });
    store.unlock("theme", "gold");
    store.merge([{ type: "theme", key: "gold", at: "2026-01-01T00:00:00Z" }]);
    expect(store.getSnapshot()[0]!.at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("主題：隱藏主題只在解鎖時有效", () => {
  const unlockedRaw = JSON.stringify([{ type: "theme", key: "coding", at: "2026-10-23T00:00:00.000Z" }]);
  it("normalizeTheme / themeOptionsFor", () => {
    expect(normalizeTheme("coding")).toBe("system");
    expect(normalizeTheme("coding", ["coding"])).toBe("coding");
    expect(normalizeTheme("bogus", ["coding"])).toBe("system");
    expect(themeOptionsFor([]).map((o) => o.id)).toEqual(["system", "light", "dark"]);
    expect(themeOptionsFor(["gold", "coding"]).map((o) => o.id)).toEqual(["system", "light", "dark", "gold", "coding"]);
    expect(UNLOCK_THEME_KEYS).toHaveLength(9);
  });
  it("readTheme / writeTheme 看解鎖紀錄", () => {
    const st = memStorage({ [THEME_STORAGE_KEY]: "coding" });
    expect(readTheme(st)).toBe("system");
    st.setItem(UNLOCKS_STORAGE_KEY, unlockedRaw);
    expect(readTheme(st)).toBe("coding");
    expect(writeTheme("gold", st)).toBe(true); // gold 沒解鎖 → 存成 system 的效果（normalize）
    expect(readTheme(st)).toBe("system");
    expect(writeTheme("coding", st)).toBe(true);
    expect(readTheme(st)).toBe("coding");
  });
  function runInit(storage: Record<string, string>): string | null {
    let attr: string | null = null;
    const doc = { documentElement: { setAttribute: (_: string, v: string) => (attr = v) } };
    new Function("localStorage", "document", THEME_INIT_SCRIPT)({ getItem: (k: string) => storage[k] ?? null }, doc);
    return attr;
  }
  it("THEME_INIT_SCRIPT：light／dark 直接套；隱藏主題需有解鎖紀錄；壞資料不丟錯", () => {
    expect(runInit({ [THEME_STORAGE_KEY]: "dark" })).toBe("dark");
    expect(runInit({ [THEME_STORAGE_KEY]: "coding" })).toBeNull();
    expect(runInit({ [THEME_STORAGE_KEY]: "coding", [UNLOCKS_STORAGE_KEY]: unlockedRaw })).toBe("coding");
    expect(runInit({ [THEME_STORAGE_KEY]: "gold", [UNLOCKS_STORAGE_KEY]: unlockedRaw })).toBeNull();
    expect(runInit({ [THEME_STORAGE_KEY]: "coding", [UNLOCKS_STORAGE_KEY]: "{bad" })).toBeNull();
    expect(runInit({ [THEME_STORAGE_KEY]: "nope" })).toBeNull();
    expect(runInit({})).toBeNull();
  });
});
