/**
 * 字典一致性檢查（i18n:check 的核心邏輯，純函式，方便單元測試）。
 * - 核心命名空間：每個語系的 key 集合必須與基準語系（第一個語系）相同，且同一個 key 的插值變數 `{x}` 也要相同。
 * - 標籤命名空間（genres／themes）：只回報缺翻譯，不算錯誤。
 */
import { flattenMessages, type Messages } from "./messages";

export interface NamespaceInput {
  namespace: string;
  /** 語系 → 字典；undefined 表示檔案不存在。 */
  byLocale: Record<string, Messages | undefined>;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

function placeholders(s: string): string {
  return [...new Set([...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort().join(",");
}

export function checkMessages(
  locales: readonly string[],
  core: readonly NamespaceInput[],
  labels: readonly NamespaceInput[],
): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { namespace, byLocale } of core) {
    const flat = new Map<string, Map<string, string>>();
    for (const locale of locales) {
      const dict = byLocale[locale];
      if (!dict) errors.push(`[${namespace}] ${locale}：字典檔不存在`);
      else flat.set(locale, flattenMessages(dict));
    }
    const all = new Set<string>();
    for (const m of flat.values()) for (const k of m.keys()) all.add(k);
    for (const [locale, m] of flat) {
      for (const key of [...all].sort()) {
        const v = m.get(key);
        if (v === undefined) errors.push(`[${namespace}] ${locale}：缺 key「${key}」`);
        else if (v.trim() === "") errors.push(`[${namespace}] ${locale}：「${key}」是空字串`);
      }
    }
    for (const key of [...all].sort()) {
      const sets = new Set([...flat.values()].map((m) => m.get(key)).filter((v): v is string => v !== undefined).map(placeholders));
      if (sets.size > 1) errors.push(`[${namespace}] 「${key}」各語系的插值變數不一致`);
    }
  }

  for (const { namespace, byLocale } of labels) {
    const flat = new Map<string, Map<string, string>>();
    for (const locale of locales) {
      const dict = byLocale[locale];
      if (!dict) warnings.push(`[${namespace}] ${locale}：字典檔不存在（全部 fallback 英文）`);
      else flat.set(locale, flattenMessages(dict));
    }
    const all = new Set<string>();
    for (const m of flat.values()) for (const k of m.keys()) all.add(k);
    for (const [locale, m] of flat) {
      const missing = [...all].filter((k) => !m.has(k)).sort();
      if (missing.length > 0) warnings.push(`[${namespace}] ${locale}：缺 ${missing.length} 個翻譯（fallback 英文）：${missing.join(", ")}`);
    }
  }

  return { errors, warnings };
}
