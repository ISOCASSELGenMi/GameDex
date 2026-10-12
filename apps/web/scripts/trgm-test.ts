/**
 * Phase 1 第 5 項：pg_trgm 中日文實測（結果記在 PR／91）。
 *   npm run db:trgm-test
 * 不寫入正式表；只用 TEMP TABLE。
 */
import pg from "pg";

const samples = [
  "薩爾達傳說 王國之淚",
  "ゼルダの伝説 ティアーズ オブ ザ キングダム",
  "ファイナルファンタジーVII リバース",
  "The Legend of Zelda: Tears of the Kingdom",
  "魔物獵人 荒野",
];
// 06 §搜尋：search_text = 正規化 + CJK bigram（這裡用最簡版 bigram 驗證行為）
const bigram = (s: string) =>
  s
    .split(/\s+/)
    .flatMap((w) => (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w) && w.length > 2
      ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
      : [w]))
    .join(" ")
    .toLowerCase();

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const out: Record<string, unknown> = {};
  try {
    const { rows: env } = await client.query(
      `SELECT version() AS version, current_setting('server_encoding') AS enc,
              datcollate, datctype FROM pg_database WHERE datname = current_database()`,
    );
    out.environment = env[0];

    const { rows: trg } = await client.query("SELECT show_trgm($1) AS t1, show_trgm($2) AS t2", ["薩爾達", "ゼルダ"]);
    out.show_trgm = trg[0];
    out.cjkTokenized = (trg[0].t1 as string[]).length > 0 && (trg[0].t2 as string[]).length > 0;

    await client.query("CREATE TEMP TABLE trgm_t (id serial, name text, search_text text)");
    for (const s of samples) await client.query("INSERT INTO trgm_t (name, search_text) VALUES ($1, $2)", [s, bigram(s)]);
    await client.query("CREATE INDEX ON trgm_t USING gin (search_text gin_trgm_ops)");
    await client.query("ANALYZE trgm_t");

    const queries = ["薩爾達", "王國之淚", "ゼルダ", "伝説", "zelda", "荒野"];
    const results: Record<string, unknown>[] = [];
    for (const q of queries) {
      const bq = bigram(q);
      const { rows } = await client.query(
        `SELECT name, round(similarity(search_text, $1)::numeric, 3) AS sim,
                round(word_similarity($1, search_text)::numeric, 3) AS wsim
           FROM trgm_t WHERE search_text ILIKE '%' || $2 || '%' OR $1 <% search_text
          ORDER BY wsim DESC LIMIT 3`,
        [bq, q.toLowerCase()],
      );
      results.push({ query: q, searchForm: bq, hits: rows });
    }
    out.queries = results;

    await client.query("SET enable_seqscan = off");
    const { rows: plan } = await client.query(
      "EXPLAIN SELECT * FROM trgm_t WHERE search_text ILIKE '%王國%'",
    );
    out.ilikeUsesIndex = plan.some((r) => String(r["QUERY PLAN"]).includes("Bitmap Index Scan"));
    out.plan = plan.map((r) => r["QUERY PLAN"]);
  } finally {
    await client.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
