/**
 * accounts 的 UI 字串（伺服器端組好，整個命名空間很小，直接以 props 送給客戶端元件；客戶端拿不到伺服器端字典）。
 * 長度上限這類數字先在這裡插值；`{provider}`、`{name}` 這類只有客戶端才知道的變數留給 str()。
 */
import { MESSAGES, createTranslator, flattenMessages, type Locale } from "@sok/i18n";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../domain/entities/password-policy";

export type AccountStrings = Readonly<Record<string, string>>;

/** prefixes 省略＝整個命名空間；header 只需要 `header.` 開頭的幾個字串，避免每一頁都帶整份字典。 */
export function accountStrings(locale: Locale, prefixes?: readonly string[]): AccountStrings {
  const t = createTranslator(locale, ["accounts"]);
  const out: Record<string, string> = {};
  for (const key of flattenMessages(MESSAGES[locale].accounts).keys()) {
    if (prefixes && !prefixes.some((p) => key.startsWith(p))) continue;
    out[key] = t.t(`accounts.${key}`, { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH });
  }
  return out;
}
