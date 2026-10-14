/**
 * 遊戲名稱的 `lang` 屬性（06 §遊戲名稱解析鏈）。
 * - 顯示名稱不同於原名 → 它來自該網站語系的 displayNames，與頁面語系相同，不必標。
 * - 顯示的就是原名 → 依文字推測語言；與頁面語系相同則不標；純漢字無法判斷（可能是中文也可能是日文）也不標。
 *   其他一律視為英文（IGDB 原名以英文／羅馬字為主）。
 * 讓螢幕閱讀器在 ja／zh-Hant 頁面用正確的語音讀英文遊戲名。
 */
import type { Locale } from "@sok/i18n";

const KANA = /[぀-ヿㇰ-ㇿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ]/;
const HAN = /[㐀-䶿一-鿿]/;

function guessLang(name: string): string | undefined {
  if (KANA.test(name)) return "ja";
  if (HANGUL.test(name)) return "ko";
  if (HAN.test(name)) return undefined;
  return "en";
}

/** 回傳要放在名稱元素上的 `lang`；不需要標則 undefined。 */
export function gameNameLang(name: string, isOriginal: boolean, locale: Locale | string): string | undefined {
  if (!isOriginal) return undefined;
  const lang = guessLang(name);
  return lang === locale ? undefined : lang;
}
