import type { AccountStrings } from "./strings";

/** 取字串並替換 `{name}` 變數；缺 key 回傳 key（i18n:check 與測試保證各語系都有）。客戶端安全（不載入字典）。 */
export function str(strings: AccountStrings, key: string, values?: Record<string, string>): string {
  let text = strings[key] ?? key;
  if (values) for (const [k, v] of Object.entries(values)) text = text.replaceAll(`{${k}}`, v);
  return text;
}
