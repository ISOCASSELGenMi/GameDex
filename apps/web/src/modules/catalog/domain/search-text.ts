/**
 * 搜尋字串（06 §搜尋）：games.searchText 與查詢字串都必須經過同一個 tokenizeForSearch()（原則五）。
 * NFKC＋小寫；連續 CJK 字元拆成相鄰雙字（bigram），拉丁文不變。
 */

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;

export function tokenizeForSearch(input: string): string {
  const s = input.normalize("NFKC").toLowerCase();
  const out: string[] = [];
  let latin = "";
  let cjk: string[] = [];
  const flushCjk = () => {
    if (cjk.length === 1) out.push(cjk[0]);
    for (let i = 0; i + 1 < cjk.length; i++) out.push(cjk[i] + cjk[i + 1]);
    cjk = [];
  };
  const flushLatin = () => {
    const t = latin.trim().replace(/\s+/g, " ");
    if (t) out.push(t);
    latin = "";
  };
  for (const ch of s) {
    if (CJK.test(ch)) {
      flushLatin();
      cjk.push(ch);
    } else {
      flushCjk();
      latin += ch;
    }
  }
  flushCjk();
  flushLatin();
  return out.join(" ");
}

/** 名稱＋別名＋在地化名稱，去重後串接（同步時更新）。 */
export function buildSearchText(names: ReadonlyArray<string | null | undefined>): string {
  const seen = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const t = tokenizeForSearch(n);
    if (t) seen.add(t);
  }
  return [...seen].join(" ");
}
