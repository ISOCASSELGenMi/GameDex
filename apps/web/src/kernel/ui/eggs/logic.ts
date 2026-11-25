/**
 * 彩蛋的純邏輯（無 DOM、無計時器依賴，可單元測試）：序列判定、科納米密技、波動拳、連點計數、閒置、每日收集物、
 * 夜貓子時段、詳情頁瀏覽計數、成就彙整。docs/design/easter-eggs.md 的觸發規則只在這裡定義一次。
 */
import {
  UNLOCK_ACHIEVEMENT_KEYS,
  UNLOCK_COLLECTIBLE_KEYS,
  type UnlockCollectibleKey,
  type UnlockRecord,
  type UnlockType,
} from "../unlocks";

// ── 背景符號 ────────────────────────────────────────────────

export const SHAPE_KINDS = ["triangle", "circle", "cross", "square"] as const;
export const BUTTON_KINDS = ["btn-a", "btn-b", "btn-x", "btn-y"] as const;
export const DPAD_KINDS = ["dpad"] as const;
export const STICK_KIND = "stick" as const;
export type SymbolKind = (typeof SHAPE_KINDS)[number] | (typeof BUTTON_KINDS)[number] | (typeof DPAD_KINDS)[number] | typeof STICK_KIND;
export const ALL_SYMBOL_KINDS: readonly SymbolKind[] = [...SHAPE_KINDS, ...BUTTON_KINDS, ...DPAD_KINDS, STICK_KIND];

export interface EggUnlockTarget {
  type: UnlockType;
  key: string;
}

export interface SymbolSequence {
  id: string;
  kinds: readonly SymbolKind[];
  unlock: EggUnlockTarget;
}

/** 彩蛋 1a／1b／1c：連續點到每一顆各一次即成立，不限順序；點到重複的或別組的就重來（那顆若屬於本組，算第一步）。 */
export const SYMBOL_SEQUENCES: readonly SymbolSequence[] = [
  { id: "shapes", kinds: ["triangle", "circle", "cross", "square"], unlock: { type: "theme", key: "sony-blue" } },
  { id: "buttons", kinds: ["btn-a", "btn-b", "btn-x", "btn-y"], unlock: { type: "theme", key: "xbox-green" } },
  { id: "dpad", kinds: ["dpad", "stick"], unlock: { type: "theme", key: "nintendo-red" } },
];

export function createSequenceTracker(sequences: readonly SymbolSequence[] = SYMBOL_SEQUENCES) {
  const seen = new Map<string, Set<SymbolKind>>(sequences.map((s) => [s.id, new Set()]));
  return {
    /** 點到一顆；回傳剛完成的序列（可能多個）。 */
    hit(kind: SymbolKind): SymbolSequence[] {
      const done: SymbolSequence[] = [];
      for (const s of sequences) {
        let set = seen.get(s.id)!;
        if (!s.kinds.includes(kind)) set.clear();
        else {
          if (set.has(kind)) set = new Set();
          set.add(kind);
          seen.set(s.id, set);
          if (set.size === s.kinds.length) {
            set.clear();
            done.push(s);
          }
        }
      }
      return done;
    },
    progress(id: string): number {
      return seen.get(id)?.size ?? 0;
    },
  };
}

// ── 彩蛋 2：科納米密技 ─────────────────────────────────────

export const KONAMI_CODES = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyB",
  "KeyA",
] as const;

/** 用最近按鍵的結尾比對（重疊的情況，如 ↑↑↑↓↓…，也能正確判定）。回傳 true＝剛完成。 */
export function createKonamiTracker(code: readonly string[] = KONAMI_CODES) {
  let history: string[] = [];
  return {
    key(keyCode: string): boolean {
      history.push(keyCode);
      if (history.length > code.length) history = history.slice(-code.length);
      const ok = history.length === code.length && history.every((k, i) => k === code[i]);
      if (ok) history = [];
      return ok;
    },
    reset(): void {
      history = [];
    },
  };
}

/** 焦點在輸入元件時不偵測。 */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// ── 彩蛋 5：波動拳 ─────────────────────────────────────────

export type StickDir = "right" | "downRight" | "down" | "downLeft" | "left" | "upLeft" | "up" | "upRight";
const DIR_ANGLES: readonly [StickDir, number][] = [
  ["right", 0],
  ["downRight", 45],
  ["down", 90],
  ["downLeft", 135],
  ["left", 180],
  ["upLeft", -135],
  ["up", -90],
  ["upRight", -45],
];

/**
 * 蘑菇頭位移（螢幕座標，y 向下）→ 八方向；位移不足半徑的 minRatio 視為回中（null）。
 * toleranceDeg：與標準方向的角度差在此內才算（預設 22.5＝八個扇區剛好鋪滿）。
 */
export function quantizeStick(dx: number, dy: number, radius: number, minRatio = 0.6, toleranceDeg = 22.5): StickDir | null {
  if (radius <= 0 || Math.hypot(dx, dy) < radius * minRatio) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best: StickDir | null = null;
  let bestDiff = Infinity;
  for (const [dir, a] of DIR_ANGLES) {
    let diff = Math.abs(angle - a);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = dir;
    }
  }
  return bestDiff <= toleranceDeg ? best : null;
}

export const HADOUKEN: readonly StickDir[] = ["down", "downRight", "right"];
export const HADOUKEN_WINDOW_MS = 1500;

/** 依序 下 → 右下 → 右，從第一步算起 windowMs 內完成。null（回中）與重複方向忽略；方向錯了重來。 */
export function createHadoukenTracker(seq: readonly StickDir[] = HADOUKEN, windowMs = HADOUKEN_WINDOW_MS) {
  let idx = 0;
  let startedAt = 0;
  let last: StickDir | null = null;
  return {
    push(dir: StickDir | null, now: number): boolean {
      if (dir === null || dir === last) return false;
      last = dir;
      if (idx > 0 && now - startedAt > windowMs) idx = 0;
      if (dir === seq[idx]) {
        if (idx === 0) startedAt = now;
        idx++;
        if (idx === seq.length) {
          idx = 0;
          last = null;
          return true;
        }
        return false;
      }
      if (dir === seq[0]) {
        idx = 1;
        startedAt = now;
      } else idx = 0;
      return false;
    },
    reset(): void {
      idx = 0;
      last = null;
    },
  };
}

// ── 彩蛋 8：連點 ───────────────────────────────────────────

/** 滑動視窗：最近 windowMs 內累計 n 次即成立（成立後清空）。 */
export function createClickCounter(n = 10, windowMs = 2000) {
  let stamps: number[] = [];
  return {
    click(now: number): boolean {
      stamps = stamps.filter((t) => now - t <= windowMs);
      stamps.push(now);
      if (stamps.length >= n) {
        stamps = [];
        return true;
      }
      return false;
    },
    count(now: number): number {
      return stamps.filter((t) => now - t <= windowMs).length;
    },
    reset(): void {
      stamps = [];
    },
  };
}

// ── 彩蛋 4：閒置 ───────────────────────────────────────────

export interface IdleScheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 閒置偵測：最後一次 activity() 之後 ms 毫秒沒有新活動就呼叫 onIdle（每次閒置只一次；activity 後重新計時）。 */
export function createIdleTracker(ms: number, onIdle: () => void, sched: IdleScheduler) {
  let last = sched.now();
  let handle: unknown = null;
  let fired = false;
  let running = false;
  function arm(delay: number): void {
    handle = sched.setTimeout(check, delay);
  }
  function check(): void {
    handle = null;
    if (!running) return;
    const idleFor = sched.now() - last;
    if (idleFor >= ms) {
      fired = true;
      onIdle();
    } else arm(ms - idleFor);
  }
  return {
    start(): void {
      running = true;
      last = sched.now();
      fired = false;
      if (handle !== null) sched.clearTimeout(handle);
      arm(ms);
    },
    activity(): void {
      last = sched.now();
      if (fired) {
        fired = false;
        if (running && handle === null) arm(ms);
      }
    },
    stop(): void {
      running = false;
      if (handle !== null) sched.clearTimeout(handle);
      handle = null;
    },
  };
}

// ── 彩蛋 3：每日收集物 ─────────────────────────────────────

/** 使用者本地日期 YYYY-MM-DD。 */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 決定性：同一天、同一份已收集清單 → 同一種。全部收集完回傳 null。 */
export function pickDailyCollectible(dateKey: string, collected: readonly string[]): UnlockCollectibleKey | null {
  const remaining = UNLOCK_COLLECTIBLE_KEYS.filter((k) => !collected.includes(k));
  if (remaining.length === 0) return null;
  return remaining[hashString(dateKey) % remaining.length]!;
}

export interface DailyState {
  date: string;
  key: UnlockCollectibleKey;
  found: boolean;
}

export const DAILY_STORAGE_KEY = "sok-egg-daily";

export function parseDaily(raw: string | null | undefined): DailyState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DailyState>;
    if (typeof v.date === "string" && typeof v.found === "boolean" && (UNLOCK_COLLECTIBLE_KEYS as readonly string[]).includes(v.key as string))
      return { date: v.date, key: v.key as UnlockCollectibleKey, found: v.found };
  } catch {
    // 壞掉的資料當沒有
  }
  return null;
}

/**
 * 今天的狀態：已有今天的紀錄就沿用（同一天重新整理看到同一個）；否則挑一個還沒收集的。
 * 回傳 null＝8 種都收集完，今天不放。
 */
export function dailyStateFor(dateKey: string, stored: DailyState | null, collected: readonly string[]): DailyState | null {
  if (stored && stored.date === dateKey && !collected.includes(stored.key)) return stored;
  if (stored && stored.date === dateKey && collected.includes(stored.key)) return { ...stored, found: true };
  const key = pickDailyCollectible(dateKey, collected);
  return key ? { date: dateKey, key, found: false } : null;
}

// ── 彩蛋 6：夜貓子 ─────────────────────────────────────────

/** 本地時間 02:00～03:59。 */
export function isNightOwlHour(d: Date): boolean {
  const h = d.getHours();
  return h >= 2 && h < 4;
}

// ── 彩蛋 7：成就 ───────────────────────────────────────────

export const VIEWED_STORAGE_KEY = "sok-egg-viewed";
export const VIEWED_GOAL = 50;

/** 同一款只算一次；達標後不再增長。 */
export function recordViewedGame(list: readonly string[], slug: string, goal = VIEWED_GOAL): { list: string[]; reached: boolean } {
  if (list.includes(slug) || list.length >= goal) return { list: [...list], reached: list.length >= goal };
  const next = [...list, slug];
  return { list: next, reached: next.length >= goal };
}

export function parseViewed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, VIEWED_GOAL) : [];
  } catch {
    return [];
  }
}

/** 遊戲詳情頁路徑 `/{locale}/games/{slug}` → slug；其他回傳 null。 */
export function gameSlugFromPath(pathname: string): string | null {
  const m = /^\/[A-Za-z-]+\/games\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function hasAllCollectibles(records: readonly UnlockRecord[]): boolean {
  return UNLOCK_COLLECTIBLE_KEYS.every((k) => records.some((r) => r.type === "collectible" && r.key === k));
}

/** 其餘成就（排除 all-achievements 自己）都達成了嗎。 */
export function othersAchieved(records: readonly UnlockRecord[]): boolean {
  return UNLOCK_ACHIEVEMENT_KEYS.filter((k) => k !== "all-achievements").every((k) =>
    records.some((r) => r.type === "achievement" && r.key === k),
  );
}
