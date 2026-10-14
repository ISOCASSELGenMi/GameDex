/**
 * 翻譯函式。key 一律帶命名空間：`t("ui.calendar.title")`、`t("enums.releaseStage.full")`、`t("genres.indie")`。
 *
 * - 插值：`{name}`。數字（number／bigint）以 Intl.NumberFormat 依語系格式化（`1234` → `1,234`）；
 *   不想分位的數字（例如年份）請先轉成字串。缺少的變數保留 `{name}` 原樣。
 * - 缺 key：回傳 key 本身，開發模式 console.warn（同一個 key 只警告一次），不 throw。
 * - genres／themes 缺翻譯：先 fallback 英文字典，再不然回傳 key。
 * - key 的命名空間不在 createTranslator 指定的清單內 → 視同缺 key。
 */
import { intlLocale, type Locale } from "./locales";
import {
  FALLBACK_LOCALE,
  LABEL_NAMESPACES,
  MESSAGES,
  NAMESPACES,
  isNamespace,
  lookupMessage,
  type Namespace,
} from "./messages";

export type TranslationValues = Readonly<Record<string, string | number | bigint>>;

export interface Translator {
  readonly locale: Locale;
  /** 翻譯；缺 key 回傳 key 本身。 */
  t(key: string, values?: TranslationValues): string;
  /** 目前語系（含 genres／themes 的英文 fallback）是否有這個 key。 */
  has(key: string): boolean;
}

function isDev(): boolean {
  try {
    // 寫成 process.env.NODE_ENV 字面形式，讓 bundler 能在客戶端替換
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

const warned = new Set<string>();
function warnMissing(locale: Locale, key: string, reason: string): void {
  if (!isDev()) return;
  const id = `${locale}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] ${reason}：${key}（${locale}）`);
}

export function interpolate(template: string, values: TranslationValues | undefined, locale: Locale): string {
  if (!values) return template;
  let nf: Intl.NumberFormat | undefined;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) return match;
    const v = values[name];
    if (typeof v === "number" || typeof v === "bigint") {
      nf ??= new Intl.NumberFormat(intlLocale(locale));
      return nf.format(v);
    }
    return String(v);
  });
}

function splitKey(key: string): { ns: Namespace; path: string } | null {
  const dot = key.indexOf(".");
  if (dot <= 0) return null;
  const ns = key.slice(0, dot);
  if (!isNamespace(ns)) return null;
  return { ns, path: key.slice(dot + 1) };
}

/**
 * 建立翻譯函式。namespaces 省略 = 全部核心＋標籤命名空間。
 * 字典是靜態 import，namespaces 主要用來限定範圍（日後可選模組的命名空間也走這裡）。
 */
export function createTranslator(locale: Locale, namespaces: readonly Namespace[] = NAMESPACES): Translator {
  const allowed = new Set<Namespace>(namespaces);
  const dict = MESSAGES[locale];
  const fallbackDict = MESSAGES[FALLBACK_LOCALE];

  function resolve(key: string): string | undefined {
    const parts = splitKey(key);
    if (!parts || !allowed.has(parts.ns)) return undefined;
    const hit = lookupMessage(dict[parts.ns], parts.path);
    if (hit !== undefined) return hit;
    if ((LABEL_NAMESPACES as readonly string[]).includes(parts.ns)) {
      return lookupMessage(fallbackDict[parts.ns], parts.path);
    }
    return undefined;
  }

  return {
    locale,
    t(key, values) {
      const template = resolve(key);
      if (template === undefined) {
        const parts = splitKey(key);
        warnMissing(locale, key, parts && !allowed.has(parts.ns) ? "命名空間未載入" : "缺少翻譯");
        return key;
      }
      return interpolate(template, values, locale);
    },
    has(key) {
      return resolve(key) !== undefined;
    },
  };
}

/**
 * genres／themes 標籤：目前語系 → 英文字典 → fallbackName（通常是 DB 的原文名稱）→ slug。
 * 用於 IGDB 新增、字典還沒收錄的 slug，避免畫面出現 `genres.xxx`。
 */
export function translateLabel(
  translator: Translator,
  namespace: (typeof LABEL_NAMESPACES)[number],
  slug: string,
  fallbackName?: string | null,
): string {
  const key = `${namespace}.${slug}`;
  if (translator.has(key)) return translator.t(key);
  warnMissing(translator.locale, key, "缺少標籤翻譯");
  return fallbackName || slug;
}
