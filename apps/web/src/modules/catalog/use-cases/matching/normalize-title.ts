/**
 * 標題正規化（05 §標題比對 §正規化）。純函式。
 * - NFKC，不是 NFKD（NFKD 會拆掉日文濁音）；只對拉丁擴充區（U+00C0~U+024F）去重音。
 * - 保留 Unicode 字母數字（含中日韓），不用 \w（會刪光 CJK，兩個空字串被判為相同而自動配對，D29／D-Bug8）。
 * - 正規化後為空字串＝無法比對，呼叫端不得把兩個空字串視為相同。
 */
export function normalizeTitle(title: string): string {
  // 商標符號要在 NFKC 之前移除：NFKC 會把 ™ 變成 "TM"（spec 範例程式碼的順序會留下 "tm"，實測發現，見報告）。
  // NFKC 也可能產生大寫（例如 ℌ → H），所以之後再轉一次小寫。
  let s = title.replace(/[™®©]/g, "").toLowerCase().normalize("NFKC").toLowerCase();
  s = s.replace(/[À-ɏ]/g, (ch) => ch.normalize("NFD").replace(/\p{M}/gu, ""));
  return s
    .replace(/&/g, " and ")
    .replace(/[:\-–—]/g, " ")
    .replace(/\b(deluxe|standard|ultimate|goty|game of the year|complete|definitive|remastered|edition)\b/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
