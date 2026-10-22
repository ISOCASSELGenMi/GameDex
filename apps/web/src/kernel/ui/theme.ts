/**
 * 主題偏好（亮／暗／跟隨系統）。純函式＋極小的 inline script，伺服器 HTML 與使用者狀態無關：
 * - 偏好存在 localStorage（鍵 THEME_STORAGE_KEY；讀寫都包 try/catch，私密視窗或封鎖時退回「系統」）。
 * - 套用方式：`<html data-theme="light|dark">`；「系統」＝不設屬性，由 CSS 的 prefers-color-scheme 決定。
 * - THEME_INIT_SCRIPT 放在 <head>，首次繪製前先套用，避免閃爍。
 * 選項清單 THEME_OPTIONS 預留隱藏主題：`locked: true` 的選項不顯示（解鎖後才進選單；現在都不顯示）。
 */

export const THEME_STORAGE_KEY = "sok-theme";

export const BASE_THEMES = ["system", "light", "dark"] as const;
export type BaseTheme = (typeof BASE_THEMES)[number];

export interface ThemeOption {
  id: string;
  /** 字典 key（ui.theme.<id>）的後綴。 */
  labelKey: string;
  /** true＝隱藏主題，解鎖前不出現在選單。 */
  locked?: boolean;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "system", labelKey: "system" },
  { id: "light", labelKey: "light" },
  { id: "dark", labelKey: "dark" },
];

export function visibleThemeOptions(options: readonly ThemeOption[] = THEME_OPTIONS): ThemeOption[] {
  return options.filter((o) => !o.locked);
}

/** 不認得的值一律當「系統」。 */
export function normalizeTheme(value: unknown): string {
  return typeof value === "string" && THEME_OPTIONS.some((o) => o.id === value && !o.locked) ? value : "system";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTheme(storage: StorageLike | null = defaultStorage()): string {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** 寫入偏好；「系統」＝移除。失敗（容量、封鎖）靜默忽略，回傳是否寫成功。 */
export function writeTheme(theme: string, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    if (theme === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
    return true;
  } catch {
    return false;
  }
}

/** 套到 <html>：system 移除屬性，其他設 data-theme。 */
export function applyTheme(theme: string, root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void }): void {
  const t = normalizeTheme(theme);
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/** <head> 的 inline script：與 readTheme／applyTheme 同一份規則（只認 light、dark）。 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
