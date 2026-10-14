/**
 * 翻譯缺漏報告（i18n:report 的核心邏輯，純函式）。
 * - missing：基準 key 集合（所有語系 key 的聯集）中，該語系沒有的 key
 * - extra：該語系有、但基準語系（第一個語系）沒有的 key
 * - sameAsFallback：值與 fallback 語系（en）逐字相同、可能尚未翻譯的 key（品牌名、純符號、純插值等已排除）
 * 與 check.ts 的差別：check 是 CI 的通過／失敗閘門，report 是給人看的清單，永遠回報全部細節。
 */
import { flattenMessages, type Messages } from "./messages";

export interface ReportNamespaceInput {
  namespace: string;
  /** 該命名空間是否為標籤型（genres／themes：缺翻譯 fallback 英文而非報錯）。 */
  kind: "core" | "label";
  byLocale: Record<string, Messages | undefined>;
}

export interface LocaleNamespaceReport {
  locale: string;
  namespace: string;
  kind: "core" | "label";
  total: number;
  missing: string[];
  extra: string[];
  sameAsFallback: string[];
  fileMissing: boolean;
}

/** 值逐字相同也屬正常的情況：沒有任何字母（符號、數字、純插值）、或全為 ASCII 的品牌／專有名詞短語。 */
const IGNORE_VALUE = /^[^\p{L}]*$/u;
const BRAND_SAME_OK = new Set(["Steam", "GOG", "Twitch", "YouTube", "Facebook", "Instagram", "Reddit", "Discord", "Bluesky", "itch.io", "Game Jolt", "Giant Bomb", "Google Play", "App Store", "Microsoft Store", "Epic Games Store", "PlayStation Store", "MOBA", "Beta", "Data from IGDB.com", "PC", "Wikipedia", "Nintendo eShop", "© SoK Studio"]);

function stripPlaceholders(v: string): string {
  return v.replace(/\{[A-Za-z0-9_]+\}/g, "");
}

export function isLikelyUntranslated(value: string, fallbackValue: string | undefined): boolean {
  if (fallbackValue === undefined || value !== fallbackValue) return false;
  const bare = stripPlaceholders(value).replace(/\s+/g, " ").trim();
  if (IGNORE_VALUE.test(bare)) return false;
  return !BRAND_SAME_OK.has(bare);
}

export function buildReport(
  locales: readonly string[],
  namespaces: readonly ReportNamespaceInput[],
  fallbackLocale: string,
): LocaleNamespaceReport[] {
  const out: LocaleNamespaceReport[] = [];
  const baseLocale = locales[0];
  for (const { namespace, kind, byLocale } of namespaces) {
    const flat = new Map<string, Map<string, string>>();
    for (const l of locales) {
      const d = byLocale[l];
      if (d) flat.set(l, flattenMessages(d));
    }
    const union = new Set<string>();
    for (const m of flat.values()) for (const k of m.keys()) union.add(k);
    const base = baseLocale ? flat.get(baseLocale) : undefined;
    const fb = flat.get(fallbackLocale);
    for (const locale of locales) {
      const m = flat.get(locale);
      if (!m) {
        out.push({ locale, namespace, kind, total: 0, missing: [...union].sort(), extra: [], sameAsFallback: [], fileMissing: true });
        continue;
      }
      const missing = [...union].filter((k) => !m.has(k)).sort();
      const extra = locale === baseLocale || !base ? [] : [...m.keys()].filter((k) => !base.has(k)).sort();
      const same =
        locale === fallbackLocale
          ? []
          : [...m].filter(([k, v]) => isLikelyUntranslated(v, fb?.get(k))).map(([k]) => k).sort();
      out.push({ locale, namespace, kind, total: m.size, missing, extra, sameAsFallback: same, fileMissing: false });
    }
  }
  return out;
}

export function formatReport(rows: readonly LocaleNamespaceReport[]): string {
  const lines: string[] = [];
  const locales = [...new Set(rows.map((r) => r.locale))];
  for (const locale of locales) {
    const mine = rows.filter((r) => r.locale === locale);
    const sum = (f: (r: LocaleNamespaceReport) => number) => mine.reduce((a, r) => a + f(r), 0);
    lines.push(`## ${locale}：${sum((r) => r.total)} 個 key，缺 ${sum((r) => r.missing.length)}、多餘 ${sum((r) => r.extra.length)}、與 en 相同 ${sum((r) => r.sameAsFallback.length)}`);
    for (const r of mine) {
      if (r.fileMissing) lines.push(`  [${r.namespace}] 字典檔不存在`);
      if (r.missing.length > 0 && !r.fileMissing) lines.push(`  [${r.namespace}] 缺 ${r.missing.length}${r.kind === "label" ? "（fallback 英文）" : ""}：${r.missing.join(", ")}`);
      if (r.extra.length > 0) lines.push(`  [${r.namespace}] 多餘 ${r.extra.length}：${r.extra.join(", ")}`);
      if (r.sameAsFallback.length > 0) lines.push(`  [${r.namespace}] 值與 en 相同（可能未翻譯）${r.sameAsFallback.length}：${r.sameAsFallback.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** `--strict` 用：有缺字典檔、缺 key、多餘 key 就算不完整（「與 en 相同」只是提示，不算）。 */
export function isIncomplete(rows: readonly LocaleNamespaceReport[]): boolean {
  return rows.some((r) => r.fileMissing || r.missing.length > 0 || r.extra.length > 0);
}
