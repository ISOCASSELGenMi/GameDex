"use client";
/**
 * header 左上角的品牌文字（GameDex／GameCalendar…）。換頁後文字改變時用「拉霸機」效果換字：
 * 各字母逐字（錯開 ≤ 10ms）上下滾動，滾過幾個填充字母後停在新字母；整體 ≤ 0.5 秒。
 *
 * - 伺服器與首次 hydration 一律輸出純文字（沒有 JavaScript、搜尋引擎、第一次進站都看到最終文字）。
 * - 上一頁的品牌記在 sessionStorage（導覽下拉是整頁導覽，記憶體變數撐不過換頁）；mount 後發現與這頁不同才播放。
 * - 播放時動畫層（一個空的 span，由 React 渲染成空、之後只有這裡用 DOM 操作填入字格）蓋過最終文字；結束後清空、還原。
 *   React 管的節點（最終文字）從頭到尾不動，所以不會與 React 的更新衝突，也不需要 setState。
 * - 版面：每個字格先量舊字與新字的寬度，再把字格寬度從舊寬動畫到新寬（超出的字格收成 0），整段文字的寬度連續變化、不會在結束時跳一下。
 * - 無障礙：外層 <a> 的 aria-label 是完整品牌字串；動畫層 aria-hidden。prefers-reduced-motion 直接換字（不建立動畫層）。
 */
import { useLayoutEffect, useRef, type ReactElement } from "react";

const STORAGE_KEY = "gd-brand";
/** 單字滾動時間與逐字錯開（毫秒）。最後一字結束時間 = (n-1)*stagger + DURATION ≤ 280（慢機器上也留足餘裕）。 */
export const BRAND_ROLL_DURATION_MS = 170;
export const BRAND_ROLL_MAX_STAGGER_TOTAL_MS = 110;
const FILLERS = "GAMEDXPLTRNKBS";
const FILLER_COUNT = 2;
const EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/** 填充字母：只依位置決定（不用亂數，畫面可重現）。 */
export function fillerAt(index: number, k: number): string {
  return FILLERS[(index * 7 + k * 5 + 3) % FILLERS.length]!;
}

/** 第 index 個字格的啟動延遲。 */
export function staggerDelay(index: number, slotCount: number): number {
  if (slotCount <= 1) return 0;
  return Math.round(Math.min(10, BRAND_ROLL_MAX_STAGGER_TOTAL_MS / (slotCount - 1)) * index);
}

function readLast(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeLast(text: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* 隱私模式等：沒有記憶就不播動畫 */
  }
}

const glyph = (ch: string | undefined) => (ch === undefined ? "" : ch === " " ? " " : ch);

function row(text: string, attr?: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "hd-roll-row";
  el.textContent = text;
  if (attr) el.setAttribute(attr, "");
  return el;
}

/** 在動畫層裡建立字格；回傳各字格元素。 */
function buildSlots(layer: HTMLElement, from: string, to: string): HTMLElement[] {
  const n = Math.max(from.length, to.length);
  const slots: HTMLElement[] = [];
  for (let i = 0; i < n; i += 1) {
    const slot = document.createElement("span");
    slot.className = "hd-roll-slot";
    slot.setAttribute("data-roll-slot", "");
    const strip = document.createElement("span");
    strip.className = "hd-roll-strip";
    strip.setAttribute("data-roll-strip", "");
    strip.append(row(glyph(from[i]), "data-roll-old"));
    for (let k = 0; k < FILLER_COUNT; k += 1) strip.append(row(fillerAt(i, k)));
    strip.append(row(glyph(to[i]), "data-roll-new"));
    slot.append(strip);
    layer.append(slot);
    slots.push(slot);
  }
  return slots;
}

export function BrandText({ text }: { text: string }): ReactElement {
  const rootRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    const last = readLast();
    writeLast(text);
    if (!root || !layer || last === null || last === text) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const slots = buildSlots(layer, last, text);
    root.setAttribute("data-brand-roll", "rolling");
    root.removeAttribute("data-roll-ms");
    root.removeAttribute("data-roll-wall");
    root.removeAttribute("data-roll-cut");
    const started = performance.now();
    const rowH = layer.querySelector<HTMLElement>(".hd-roll-row")?.getBoundingClientRect().height ?? 0;
    const anims: Animation[] = [];
    slots.forEach((slot, i) => {
      const oldW = slot.querySelector<HTMLElement>("[data-roll-old]")?.getBoundingClientRect().width ?? 0;
      const newW = slot.querySelector<HTMLElement>("[data-roll-new]")?.getBoundingClientRect().width ?? 0;
      const opts: KeyframeAnimationOptions = { duration: BRAND_ROLL_DURATION_MS, delay: staggerDelay(i, slots.length), easing: EASING, fill: "both" };
      slot.style.width = `${oldW}px`;
      anims.push(slot.animate({ width: [`${oldW}px`, `${newW}px`] }, opts));
      const strip = slot.querySelector<HTMLElement>("[data-roll-strip]");
      if (strip) anims.push(strip.animate({ transform: ["translateY(0)", `translateY(${-(FILLER_COUNT + 1) * rowH}px)`] }, opts));
    });

    let finished = false;
    const finish = (measure: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      // data-roll-ms：動畫本身的時間（取消動畫之前先讀）；data-roll-wall：從 effect 開始算的牆鐘時間
      // 用動畫自己的時間軸算（最後一個字格的結束時間 − 第一個字格的開始時間），不是「回呼什麼時候被執行」：主執行緒忙碌只會延後回呼，不會讓動畫變長
      let t0 = Infinity;
      let t1 = -Infinity;
      for (const a of anims) {
        const st = a.startTime;
        const end = a.effect?.getComputedTiming().endTime;
        if (typeof st === "number" && typeof end === "number") {
          t0 = Math.min(t0, st);
          t1 = Math.max(t1, st + end);
        }
      }
      const own = Number.isFinite(t0) ? t1 - t0 : performance.now() - started;
      root.setAttribute("data-roll-ms", String(Math.round(own)));
      root.setAttribute("data-roll-wall", String(Math.round(performance.now() - started)));
      if (!measure) root.setAttribute("data-roll-cut", "");
      anims.forEach((a) => a.cancel());
      layer.textContent = "";
      root.setAttribute("data-brand-roll", "idle");
    };
    Promise.all(anims.map((a) => a.finished)).then(() => finish(true), () => undefined);
    // 保險：動畫被中斷（分頁切到背景等）時最晚 0.8 秒後還原成純文字
    const timer = window.setTimeout(() => finish(false), 800);
    return () => {
      if (!finished) {
        finished = true;
        window.clearTimeout(timer);
        anims.forEach((a) => a.cancel());
        layer.textContent = "";
        root.setAttribute("data-brand-roll", "idle");
      }
    };
  }, [text]);

  return (
    <span ref={rootRef} className="hd-brand-text" data-brand-roll="idle">
      <span className="hd-brand-final">{text}</span>
      <span ref={layerRef} className="hd-brand-layer" aria-hidden="true" />
    </span>
  );
}
