/** Levenshtein 編輯距離（以 Unicode 字元計，不拆代理對）。自寫，不加套件。 */
function levenshteinDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * 相似度 0~1 ＝ 1 − 編輯距離 / 較長字串長度。兩個都是空字串回 0（空字串不可與任何字串視為相同，05）。
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 0;
  return 1 - levenshteinDistance(x, y) / longest;
}
