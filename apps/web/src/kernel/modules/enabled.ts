import type { EnvLike } from "../config/env";

/**
 * 模組啟用判斷的唯一實作（原則五）。
 * registry 與 guardModule 都呼叫這裡；kernel 本身不 import 任何模組。
 */

/** 可選模組名稱；新增模組時在這裡登記（02 §追加與移除功能）。 */
export const OPTIONAL_MODULE_NAMES = [
  "accounts",
  "discord",
  "notifications",
  "awards",
  "social",
  "metacritic",
  "admin",
] as const;
export type OptionalModuleName = (typeof OPTIONAL_MODULE_NAMES)[number];

/** MODULES 未設定時的預設清單（16 §環境變數）。 */
export const DEFAULT_MODULES: readonly string[] = ["accounts", "discord", "admin"];

/** 未設定 → 預設清單；"none" → 空集合；否則逗號分隔。 */
export function parseModules(raw: string | undefined): Set<string> {
  if (raw === undefined || raw.trim() === "") return new Set(DEFAULT_MODULES);
  const v = raw.trim().toLowerCase();
  if (v === "none") return new Set();
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
}

/** metacritic 只認 METACRITIC_SCRAPE_ENABLED，不由 MODULES 控制（原則三）。 */
export function isModuleEnabled(name: string, env: EnvLike = process.env): boolean {
  if (name === "catalog") return true;
  if (name === "metacritic") return env.METACRITIC_SCRAPE_ENABLED === "true";
  return parseModules(env.MODULES).has(name);
}

/** MODULES 裡出現未知名稱 → 回傳清單，啟動檢查會拒絕啟動（避免打錯字默默停用功能）。 */
export function unknownModuleNames(env: EnvLike = process.env): string[] {
  const known = new Set<string>(OPTIONAL_MODULE_NAMES);
  return [...parseModules(env.MODULES)].filter((n) => !known.has(n) || n === "metacritic");
}
