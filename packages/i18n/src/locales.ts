/**
 * 語系清單與設定解析（spec 06 §多語系、16 §環境變數）。
 * 加入新語系（例如 Phase 3.5 的 ja）：在 AVAILABLE_LOCALES 加值、建 messages/<locale>/ 字典、
 * 在 messages.ts 註冊、在 LOCALE_SELF_NAMES／format.ts 的樣板補上即可。
 */

/** 有字典的語系（順序 = 語言選單預設順序）。 */
export const AVAILABLE_LOCALES = ["zh-Hant", "en", "ja"] as const;
export type Locale = (typeof AVAILABLE_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-Hant";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (AVAILABLE_LOCALES as readonly string[]).includes(value);
}

/**
 * env `SUPPORTED_LOCALES`（逗號分隔，例如 `zh-Hant,en,ja`）與 AVAILABLE_LOCALES 取交集，保留 env 的順序、去重。
 * 未設定 → AVAILABLE_LOCALES；交集為空 → [DEFAULT_LOCALE]。大小寫必須完全相符（`zh-hant` 不算）。
 */
export function resolveSupportedLocales(envValue?: string | null): Locale[] {
  if (envValue == null || envValue.trim() === "") return [...AVAILABLE_LOCALES];
  const out: Locale[] = [];
  for (const raw of envValue.split(",")) {
    const v = raw.trim();
    if (isLocale(v) && !out.includes(v)) out.push(v);
  }
  return out.length > 0 ? out : [DEFAULT_LOCALE];
}

/**
 * env `DEFAULT_LOCALE` 的解析：值合法且在 supported 內 → 用它；否則 DEFAULT_LOCALE（若在 supported 內）；
 * 再不然 supported[0]。保證回傳值一定在 supported 內。
 */
export function resolveDefaultLocale(envValue: string | null | undefined, supported: readonly Locale[]): Locale {
  const v = envValue?.trim();
  if (isLocale(v) && supported.includes(v)) return v;
  if (supported.includes(DEFAULT_LOCALE)) return DEFAULT_LOCALE;
  return supported[0] ?? DEFAULT_LOCALE;
}

/** 語言選單用的自稱。ja 先放著，加入 AVAILABLE_LOCALES 後就會用到。 */
const LOCALE_SELF_NAMES: Readonly<Record<string, string>> = {
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
};

export function localeSelfName(locale: Locale): string {
  return LOCALE_SELF_NAMES[locale] ?? locale;
}

/**
 * 給 Intl 用的 BCP 47 標籤。目前與 Locale 相同（`zh-Hant` 的預設地區即 TW），集中在這裡以便日後調整。
 * 也可直接用在 HTML `lang` 屬性。
 */
export function intlLocale(locale: Locale): string {
  return locale;
}
