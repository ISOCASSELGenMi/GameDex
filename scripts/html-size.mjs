// 量頁面 HTML 位元組數（含 RSC payload 的 <script>）：node scripts/html-size.mjs <網址，例 http://localhost:3300> <路徑…>
// 例：node scripts/html-size.mjs http://localhost:3300 /calendar /trending /ratings "/games?by=none"
// 每個路徑量 zh-Hant、en、ja；預算預設 < 200,000 bytes（環境變數 HTML_BUDGET 可改，月曆頁用 250000）（06 §瀏覽與搜尋）。連真實資料的 `next start` 用。
const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) {
  console.error("用法：node scripts/html-size.mjs <網址> <路徑…>");
  process.exit(2);
}
const BUDGET = Number(process.env.HTML_BUDGET ?? 200_000);
let over = 0;
for (const p of paths) {
  const cells = [];
  for (const locale of ["zh-Hant", "en", "ja"]) {
    const res = await fetch(`${base}/${locale}${p === "/" ? "" : p}`);
    const html = Buffer.from(await res.arrayBuffer());
    let flight = 0;
    for (const m of html.toString("utf8").matchAll(/<script>self\.__next_f\.push\([\s\S]*?\)<\/script>/g)) flight += Buffer.byteLength(m[0]);
    if (res.status !== 200 || html.length >= BUDGET) over++;
    cells.push(`${locale} ${res.status} ${html.length} (flight ${flight})`);
  }
  console.log(p, "|", cells.join(" | "));
}
process.exit(over > 0 ? 1 : 0);
