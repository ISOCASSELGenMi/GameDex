/**
 * 主題偏好（亮／暗／跟隨系統）。純函式＋極小的 inline script，伺服器 HTML 與使用者狀態無關：
 * - 偏好存在 localStorage（鍵 THEME_STORAGE_KEY；讀寫都包 try/catch，私密視窗或封鎖時退回「系統」）。
 * - 套用方式：`<html data-theme="light|dark">`；「系統」＝不設屬性，由 CSS 的 prefers-color-scheme 決定。
 * - THEME_INIT_SCRIPT 放在 <head>，首次繪製前先套用，避免閃爍。
 * 隱藏主題（彩蛋解鎖，kernel/ui/unlocks.ts 的 UNLOCK_THEME_KEYS）：`locked: true`；只有 localStorage 的解鎖紀錄裡有它才會被選用／套用，
 * 否則一律退回「系統」。選單的可見清單用 themeOptionsFor(已解鎖主題 key)。
 */

import { UNLOCK_THEME_KEYS } from "./unlocks";
import { UNLOCKS_STORAGE_KEY, parseUnlocks } from "./unlock-store";

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

const HIDDEN_LABEL_KEYS: Record<(typeof UNLOCK_THEME_KEYS)[number], string> = {
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

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "system", labelKey: "system" },
  { id: "light", labelKey: "light" },
  { id: "dark", labelKey: "dark" },
  ...UNLOCK_THEME_KEYS.map((key) => ({ id: key, labelKey: HIDDEN_LABEL_KEYS[key], locked: true })),
];

/** 隱藏主題的選單文字 key（ui.theme.<labelKey>）。 */
export const HIDDEN_THEME_IDS: readonly string[] = UNLOCK_THEME_KEYS;

export function visibleThemeOptions(options: readonly ThemeOption[] = THEME_OPTIONS): ThemeOption[] {
  return options.filter((o) => !o.locked);
}

/** 基本選項＋已解鎖的隱藏主題（依 UNLOCK_THEME_KEYS 的順序）。 */
export function themeOptionsFor(unlockedThemeKeys: readonly string[], options: readonly ThemeOption[] = THEME_OPTIONS): ThemeOption[] {
  return options.filter((o) => !o.locked || unlockedThemeKeys.includes(o.id));
}

/** 不認得的值、或隱藏主題但尚未解鎖，一律當「系統」。 */
export function normalizeTheme(value: unknown, unlockedThemeKeys: readonly string[] = []): string {
  if (typeof value !== "string") return "system";
  const opt = THEME_OPTIONS.find((o) => o.id === value);
  if (!opt) return "system";
  return opt.locked && !unlockedThemeKeys.includes(value) ? "system" : value;
}

/** localStorage 的解鎖紀錄裡已解鎖的主題 key。 */
export function readUnlockedThemeKeys(storage: Pick<StorageLike, "getItem"> | null = defaultStorage()): string[] {
  try {
    return parseUnlocks(storage?.getItem(UNLOCKS_STORAGE_KEY)).filter((r) => r.type === "theme").map((r) => r.key);
  } catch {
    return [];
  }
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
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY), readUnlockedThemeKeys(storage));
  } catch {
    return "system";
  }
}

/** 寫入偏好；「系統」＝移除。失敗（容量、封鎖）靜默忽略，回傳是否寫成功。 */
export function writeTheme(theme: string, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    if (theme === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme, readUnlockedThemeKeys(storage)));
    return true;
  } catch {
    return false;
  }
}

/** 套到 <html>：system 移除屬性，其他設 data-theme。 */
export function applyTheme(
  theme: string,
  root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void },
  unlockedThemeKeys: readonly string[] = readUnlockedThemeKeys(),
): void {
  const t = normalizeTheme(theme, unlockedThemeKeys);
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/**
 * <head> 的 inline script：與 readTheme／applyTheme 同一份規則。
 * light／dark 直接套；隱藏主題只在 localStorage 的解鎖紀錄（鍵 ${UNLOCKS_STORAGE_KEY}）裡有 type=theme 的同名 key 時才套，否則不設屬性（跟隨系統）。
 */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")d.setAttribute("data-theme",t);else if(${JSON.stringify(UNLOCK_THEME_KEYS)}.indexOf(t)>=0){var u=JSON.parse(localStorage.getItem(${JSON.stringify(UNLOCKS_STORAGE_KEY)})||"[]");if(Array.isArray(u))for(var i=0;i<u.length;i++)if(u[i]&&u[i].type==="theme"&&u[i].key===t){d.setAttribute("data-theme",t);break}}}catch(e){}`;
