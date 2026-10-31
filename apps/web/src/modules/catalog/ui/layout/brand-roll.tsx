"use client";
/**
 * header 左上角的品牌文字（GameDex／GameCalendar…）。換頁後文字改變時用「拉霸機」效果換字：
 * 開頭的「Game」固定不動；後綴的每個字母從「舊標題的字」轉到「新標題的字」，中間只經過 1～2 個字母（轉兩三格就停）。
 * 轉動方向看舊、新標題在導覽下拉裡的先後：往後面的項目走＝往上轉（新字從下方進來），往前面的項目走＝往下轉。
 * 滾動時帶垂直動態模糊，由左到右依序停下，停下時衝過頭再回彈。整體約 0.9 秒。
 *
 * - 伺服器與首次 hydration 一律輸出純文字（沒有 JavaScript、搜尋引擎、第一次進站都看到最終文字）。
 * - 上一頁的品牌記在 sessionStorage（導覽下拉是整頁導覽，記憶體變數撐不過換頁）；mount 後發現與這頁不同才播放。
 * - 播放時動畫層（一個空的 span，由 React 渲染成空、之後只有這裡用 DOM 操作填入字格）蓋過最終文字；結束後清空、還原。
 *   React 管的節點（最終文字）從頭到尾不動，所以不會與 React 的更新衝突，也不需要 setState。
 * - 版面：每個字格先量舊字與新字的寬度，再把字格寬度從舊寬動畫到新寬（超出的字格收成 0），整段文字的寬度連續變化、不會在結束時跳一下。
 * - 動態模糊：SVG 濾鏡 feGaussianBlur（只模糊垂直方向），只在前段套用，接近停下時拿掉；濾鏡定義放在動畫層裡，隨動畫層清掉。
 * - 無障礙：外層 <a> 的 aria-label 是完整品牌字串；動畫層 aria-hidden。prefers-reduced-motion 直接換字（不建立動畫層）。
 */
import { useLayoutEffect, useRef, type ReactElement } from "react";
import { SECTION_BRANDS } from "./nav-items";

const STORAGE_KEY = "gd-brand";
/** 第 0 個字格的滾動時間；之後每個字格多滾 STEP（由左到右依序停下）。最長品牌（後綴 8 字）約 450＋7×60＝870ms。 */
export const BRAND_ROLL_BASE_MS = 450;
export const BRAND_ROLL_STEP_MS = 60;
/** 舊字與新字之間最多經過幾個字母（「轉兩三次」＝舊字→中間 1～2 個→新字）。 */
export const BRAND_ROLL_MAX_MIDDLE = 2;
const FIXED_PREFIX = "Game";
const BLUR_ID = "gd-roll-blur";
/** 前段（滾動）佔總時間的比例；之後是衝過頭與回彈。 */
const SPIN_PART = 0.8;

/** 第 index 個字格的總滾動時間（毫秒）。 */
export function slotDuration(index: number): number {
  return BRAND_ROLL_BASE_MS + index * BRAND_ROLL_STEP_MS;
}

/** 轉動方向：新標題在導覽下拉裡排在舊標題後面＝往上轉（1）；排在前面＝往下轉（-1）；其中一個不在清單裡就往上。 */
export function rollDirection(from: string, to: string): 1 | -1 {
  const a = SECTION_BRANDS.findIndex((b) => b.brand === from);
  const b = SECTION_BRANDS.findIndex((b) => b.brand === to);
  return a >= 0 && b >= 0 && b < a ? -1 : 1;
}

/** 字母的下一個／上一個（同大小寫，Z 後接 A）；非英文字母原樣回傳。 */
export function shiftLetter(ch: string, by: number): string {
  const upper = ch >= "A" && ch <= "Z";
  const lower = ch >= "a" && ch <= "z";
  if (!upper && !lower) return ch;
  const base = upper ? 65 : 97;
  return String.fromCharCode(base + ((((ch.charCodeAt(0) - base + by) % 26) + 26) % 26));
}

/**
 * 舊字到新字之間經過的字母（依時間順序，不含頭尾）：沿字母表往 step 方向走，最多 BRAND_ROLL_MAX_MIDDLE 個，平均分布；
 * 新舊字相同＝不轉（空陣列）；不是同大小寫的英文字母（或其中一邊沒有字）＝新字前面連續的字母。
 */
export function middleLetters(from: string | undefined, to: string, step: 1 | -1): string[] {
  const isLetter = (c: string | undefined): c is string => c !== undefined && /^[A-Za-z]$/.test(c);
  if (from === to) return [];
  if (isLetter(from) && isLetter(to) && (from === from.toUpperCase()) === (to === to.toUpperCase())) {
    const dist = (((to.charCodeAt(0) - from.charCodeAt(0)) * step) % 26 + 26) % 26; // 1..25
    const n = Math.min(BRAND_ROLL_MAX_MIDDLE, dist - 1);
    return Array.from({ length: n }, (_, k) => shiftLetter(from, step * Math.round((dist * (k + 1)) / (n + 1))));
  }
  if (!isLetter(to)) return [];
  return Array.from({ length: BRAND_ROLL_MAX_MIDDLE }, (_, k) => shiftLetter(to, -step * (BRAND_ROLL_MAX_MIDDLE - k)));
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

/**
 * 在動畫層裡建立字格；回傳各字格元素。
 * 捲軸由上而下：往上轉＝[舊字, …中間…, 新字, 新字的下一個字母]；往下轉＝反過來[新字的上一個字母, 新字, …中間…, 舊字]
 * （最外側那一列只在回彈衝過頭時露出）。字母由上而下都是字母表順序遞增。
 */
function buildSlots(layer: HTMLElement, from: string, to: string, prefix: string, dir: 1 | -1): HTMLElement[] {
  const n = Math.max(from.length, to.length);
  const slots: HTMLElement[] = [];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "hd-roll-defs");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.innerHTML = `<filter id="${BLUR_ID}" x="-20%" y="-10%" width="140%" height="120%"><feGaussianBlur stdDeviation="0 1.2"/></filter>`;
  layer.append(svg);
  if (prefix) {
    const fixed = document.createElement("span");
    fixed.className = "hd-roll-fixed";
    fixed.textContent = prefix;
    layer.append(fixed);
  }
  for (let i = 0; i < n; i += 1) {
    const target = to[i];
    const slot = document.createElement("span");
    slot.className = "hd-roll-slot";
    slot.setAttribute("data-roll-slot", "");
    const strip = document.createElement("span");
    strip.className = "hd-roll-strip";
    strip.setAttribute("data-roll-strip", "");
    const oldRow = row(glyph(from[i]), "data-roll-old");
    if (target === undefined) {
      strip.append(oldRow, row("", "data-roll-new")); // 新字比較短：這一格收成空白
    } else {
      const middle = middleLetters(from[i], target, dir).map((ch) => row(ch));
      const newRow = row(glyph(target), "data-roll-new");
      if (dir === 1) strip.append(oldRow, ...middle, newRow, row(shiftLetter(target, 1)));
      else strip.append(row(shiftLetter(target, -1)), newRow, ...middle.reverse(), oldRow);
    }
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

    // 「Game」固定不動，只有後綴滾動（兩邊都以 Game 開頭才成立；否則整串滾動）
    const prefix = last.startsWith(FIXED_PREFIX) && text.startsWith(FIXED_PREFIX) ? FIXED_PREFIX : "";
    const dir = rollDirection(last, text);
    const slots = buildSlots(layer, last.slice(prefix.length), text.slice(prefix.length), prefix, dir);
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
      const duration = slotDuration(i);
      slot.style.width = `${oldW}px`;
      anims.push(slot.animate({ width: [`${oldW}px`, `${newW}px`] }, { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both" }));
      const strip = slot.querySelector<HTMLElement>("[data-roll-strip]");
      if (!strip) return;
      // 往上轉：從第 0 列捲到新字那一列（倒數第二列）；往下轉：從舊字那一列（最後一列）捲到新字那一列（第 1 列）
      const rows = strip.children.length;
      const from = dir === 1 ? 0 : -(rows - 1) * rowH;
      const end = dir === 1 ? -(rows - 2) * rowH : -rowH;
      const over = 0.28 * rowH * dir * -1; // 衝過頭：沿前進方向多走一點（往上轉＝更負，往下轉＝更正）
      anims.push(
        strip.animate(
          [
            { transform: `translateY(${from}px)`, offset: 0, easing: "cubic-bezier(0.25, 0.1, 0.3, 1)" }, // 起步很快、接近終點才減速
            { transform: `translateY(${end + over}px)`, offset: SPIN_PART, easing: "ease-in-out" }, // 衝過頭
            { transform: `translateY(${end - over * 0.25}px)`, offset: 0.92, easing: "ease-in-out" }, // 回彈過一點
            { transform: `translateY(${end}px)`, offset: 1 },
          ],
          { duration, fill: "both" },
        ),
      );
      // 動態模糊：高速段（前 70%）套用，之後清晰；filter 的 url() 與 none 不能補間，所以用一條只活 70% 的動畫
      anims.push(strip.animate([{ filter: `url(#${BLUR_ID})` }, { filter: `url(#${BLUR_ID})` }], { duration: duration * 0.7, fill: "none" }));
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
    // 保險：動畫被中斷（分頁切到背景等）時最晚 2 秒後還原成純文字
    const timer = window.setTimeout(() => finish(false), 2000);
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
