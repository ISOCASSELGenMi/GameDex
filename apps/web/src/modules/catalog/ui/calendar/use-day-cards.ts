"use client";
/**
 * 「同一天的多款遊戲」切換邏輯（月曆格 DayCell 與時間軸日卡 TimelineDayCard 共用，只實作這一份）。
 * - 伺服器首屏只送當天第一款；使用者第一次切換才呼叫 day API 載入全部，之後在記憶體內切換（同網址的回應共用快取）。
 * - 切換方式：左右按鈕、鍵盤左右鍵（焦點在元素內時）、觸控橫向滑動。到頭尾會繞回另一端。
 * - 目前那款由呼叫端放在 aria-live="polite" 的 `announce` 宣告。
 * 沒有任何時間性的動畫邏輯：動畫只存在於 CSS 的 prefers-reduced-motion: no-preference。
 */
import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import type { CalendarDayResponse, DayCardData } from "./types";

const SWIPE_MIN_PX = 40;

const dayCache = new Map<string, Promise<CalendarDayResponse>>();

export function loadDay(url: string): Promise<CalendarDayResponse> {
  let p = dayCache.get(url);
  if (!p) {
    p = fetch(url, { headers: { Accept: "application/json" } }).then((res) => {
      if (!res.ok) throw new Error(`day ${res.status}`);
      return res.json() as Promise<CalendarDayResponse>;
    });
    dayCache.set(url, p);
    p.catch(() => dayCache.delete(url));
  }
  return p;
}

const noopSubscribe = () => () => {};

/** 水合完成才為 true（伺服器端與水合當下為 false）：沒有 JS 時不放切換控制項。 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** 使用者裝置的「今天」（YYYY-MM-DD）；伺服器端與水合當下為空字串（輸出不含今天，頁面可被共用快取）。 */
export function useLocalToday(): string {
  return useSyncExternalStore(noopSubscribe, localTodayIso, () => "");
}

function localTodayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 字典樣板的 {name} 代入。 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export interface UseDayCardsInput {
  date: string;
  /** day API 網址（含 locale 與篩選 query，不含 date）。 */
  apiBase: string;
  first: DayCardData | null;
  total: number;
  /** 即時宣告的樣板：「{name}，第 {index}／{total} 款」。 */
  currentLabel: string;
}

export interface DayCards {
  cards: DayCardData[];
  card: DayCardData | null;
  count: number;
  index: number;
  dir: "none" | "next" | "prev";
  busy: boolean;
  failed: boolean;
  announce: string;
  hydrated: boolean;
  /** 款數 > 1 且已水合：才放切換控制項。 */
  multi: boolean;
  go: (delta: 1 | -1) => Promise<void>;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  /** 剛滑動完（短時間內）：呼叫端的連結 click 要忽略。 */
  swiped: { current: boolean };
}

export function useDayCards({ date, apiBase, first, total, currentLabel }: UseDayCardsInput): DayCards {
  const hydrated = useHydrated();
  const [cards, setCards] = useState<DayCardData[]>(first ? [first] : []);
  const [count, setCount] = useState(total);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"none" | "next" | "prev">("none");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const multi = count > 1 && hydrated;

  const go = useCallback(
    async (delta: 1 | -1) => {
      if (count < 2 || busy) return;
      const target = (index + delta + count) % count;
      let list = cards;
      if (target >= list.length) {
        setBusy(true);
        setFailed(false);
        try {
          const res = await loadDay(`${apiBase}&date=${date}`);
          list = res.cards;
          setCards(res.cards);
          setCount(res.cards.length);
        } catch {
          setFailed(true);
          setBusy(false);
          return;
        }
        setBusy(false);
      }
      if (list.length === 0) return;
      const next = Math.min(target, list.length - 1);
      setDir(delta === 1 ? "next" : "prev");
      setIndex(next);
      setAnnounce(fillTemplate(currentLabel, { name: list[next]!.n, index: next + 1, total: list.length }));
    },
    [apiBase, busy, cards, count, currentLabel, date, index],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!multi || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void go(-1);
      }
    },
    [go, multi],
  );

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" || !multi) return;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped.current = true;
      setTimeout(() => {
        swiped.current = false;
      }, 80);
      void go(dx < 0 ? 1 : -1);
    }
  };
  const onPointerCancel = () => {
    drag.current = null;
  };

  return { cards, card: cards[index] ?? null, count, index, dir, busy, failed, announce, hydrated, multi, go, onKeyDown, onPointerDown, onPointerUp, onPointerCancel, swiped };
}
