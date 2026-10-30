/** 守住捲動位置的最長時間（毫秒）：涵蓋伺服器回應與換新內容；使用者自己操作捲動時立刻放手。 */
const HOLD_MS = 4000;
const USER_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

let release: (() => void) | null = null;

/**
 * 篩選導覽（router.replace，scroll: false）開始時呼叫：守住目前的捲動位置，直到內容換新完成。
 * 實測（Chromium）新內容換進來時 scrollY 偶爾被歸零（高度並未縮短）；scroll: false 只是「不主動捲動」，不會補回。
 * 逐幀檢查、被改動就捲回去，直到逾時或使用者自己操作（滾輪／觸控／鍵盤／點擊）。
 * 與元件生命週期無關：chip 連結導覽完成後會被移除，不能掛在元件的 effect 上。
 * 新內容比原本矮時 scrollTo 會自然夾到底部。
 */
export function holdScroll(): void {
  release?.();
  const y = window.scrollY;
  const x = window.scrollX;
  const started = performance.now();
  let raf = 0;
  const stop = () => {
    window.cancelAnimationFrame(raf);
    for (const e of USER_EVENTS) window.removeEventListener(e, stop);
    if (release === stop) release = null;
  };
  release = stop;
  // 觸發這次導覽的那個操作（點擊／按鍵）已經過去；之後的輸入才算使用者要自己捲
  window.setTimeout(() => {
    if (release === stop) for (const e of USER_EVENTS) window.addEventListener(e, stop, { passive: true });
  }, 50);
  const tick = () => {
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, left: x, behavior: "instant" });
    if (performance.now() - started < HOLD_MS) raf = window.requestAnimationFrame(tick);
    else stop();
  };
  raf = window.requestAnimationFrame(tick);
}
