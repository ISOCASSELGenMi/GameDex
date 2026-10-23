/**
 * 主題切換的客戶端控制器（主題下拉與「立即套用」按鈕共用）：寫 localStorage、套到 <html>、通知訂閱者。
 * 切換時短暫加上 `theme-fade`（globals／themes.css 只對 background-color、color、border-color 做 ≤ 200ms 的轉場）；reduced-motion 直接切換。
 */
import { THEME_STORAGE_KEY, applyTheme, readTheme, writeTheme } from "./theme";

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  // 其他分頁改了主題 → 套用並跟著變
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme(), document.documentElement);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const getThemeSnapshot = (): string => readTheme();
export const getServerThemeSnapshot = (): string => "system";

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

export function selectTheme(id: string): void {
  const root = document.documentElement;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("theme-fade"), 240);
  }
  writeTheme(id);
  applyTheme(id, root);
  notify();
}
