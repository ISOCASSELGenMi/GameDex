// Metacritic 配對人工校驗循環的工具（本機用）：
//   npm -w apps/web exec -- tsx --import ./scripts/load-env.ts scripts/metacritic-review.ts facts
//     補抓「還沒有 Metacritic 頁面資料」的配對頁（發售日、標題、公司、平台），存進資料庫 metacritic_pages（與驗證共用的快取）；共用每日額度，排程之外不另開請求。
//   … import-facts   一次性把舊側檔 .local/metacritic-facts.json 匯入 metacritic_pages（冪等；已存在的列不覆蓋）
//   … export   把目前狀態輸出成 .local/review-rows.json（給校驗頁面用）
//   … apply <decisions.json>   套用人工勾選：勾＝相符（manual 確認）、沒勾＝不同一部作品（拒絕、刪分數）。decisions.json: { "<external_ids.id>": true|false }
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "@/kernel/db/client";
import { confirmExternalMatch, rejectExternalMatch } from "@/modules/catalog";
import { sql } from "drizzle-orm";
import { METACRITIC_SOURCE } from "@/modules/metacritic/provider/provider";
import { loadBudget } from "@/modules/metacritic/use-cases/runtime";
import { loadPageFacts } from "@/modules/metacritic";
import { FACTS_FILE, importFactsFile, runFactsStep } from "./lib/review-facts";

const LOCAL = path.resolve(process.cwd(), "../../.local");
const ROWS_FILE = path.join(LOCAL, "review-rows.json");

async function cmdFacts(max: number): Promise<void> {
  const r = await runFactsStep({ max });
  if (r.skipped) return void console.log(`略過：${r.skipped}`);
  const total = (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM metacritic_pages`)).rows[0]!.n;
  console.log(`補抓 ${r.fetched} 頁（請求 ${r.requests}），快取累計 ${total} 頁；今日額度剩 ${(await loadBudget()).remaining()}`);
}

async function cmdImportFacts(): Promise<void> {
  const r = await importFactsFile();
  console.log(r ? `匯入 ${FACTS_FILE}：共 ${r.total} 筆，新增 ${r.added}（已存在 ${r.total - r.added - r.skipped}、無效略過 ${r.skipped}）` : `找不到 ${FACTS_FILE}，沒有東西可匯入`);
}

interface Row {
  /** external_ids.id；已移除的（否決表）為 "r<id>"。 */
  id: string;
  gameId: number;
  name: string;
  igdbUrl: string;
  steamUrl: string | null;
  mcSlug: string;
  mcUrl: string;
  mcTitle: string | null;
  mcDate: string | null;
  mcCompanies: string[];
  mcFetched: boolean;
  ourDates: string[];
  ourFirstDate: string | null;
  ourCompanies: string[];
  ourPlatforms: string[];
  confidence: number | null;
  method: string;
  needsReview: boolean;
  metascore: number | null;
  /** 區塊：skip＝不須校驗；done＝已完成；todo＝待校驗；wait＝待下一輪抓取。 */
  section: "skip" | "done" | "todo" | "wait";
  /** 預設勾選＝目前狀態下視為相符。 */
  checked: boolean;
}

async function cmdExport(): Promise<void> {
  const common = sql`
    g.id AS gid, g.name, g.slug AS gslug, g.igdb_id,
    (SELECT s.external_id FROM external_ids s WHERE s.game_id = g.id AND s.source = 'steam' LIMIT 1) AS steam,
    (SELECT array_agg(DISTINCT d::text ORDER BY d::text) FROM (SELECT re.release_date AS d FROM release_events re WHERE re.game_id = g.id AND re.precision = 'day' AND re.source_status = 'active' AND re.release_date IS NOT NULL) x) AS dates,
    g.first_release_date::text AS first_date,
    (SELECT array_agg(DISTINCT c.name) FROM game_companies gc JOIN companies c ON c.id = gc.company_id WHERE gc.game_id = g.id AND gc.role IN ('developer','publisher')) AS companies,
    (SELECT array_agg(DISTINCT p.name) FROM game_platforms gp JOIN platforms p ON p.id = gp.platform_id WHERE gp.game_id = g.id) AS platforms`;
  type R = { id: string; slug: string; pct: number | null; mm: string; nr: boolean; gid: number; name: string; gslug: string; igdb_id: number; steam: string | null; dates: string[] | null; first_date: string | null; companies: string[] | null; platforms: string[] | null; metascore: number | null };
  const matched = (await getDb().execute<R>(sql`
    SELECT e.id::text AS id, e.external_id AS slug, e.confidence_pct AS pct, e.match_method AS mm, e.needs_review AS nr, ${common},
      (SELECT max(score)::int FROM ratings r WHERE r.game_id = g.id AND r.score_provider = ${METACRITIC_SOURCE} AND r.score_type = 'metascore') AS metascore
    FROM external_ids e JOIN games g ON g.id = e.game_id WHERE e.source = ${METACRITIC_SOURCE} ORDER BY g.name`)).rows;
  const removed = (await getDb().execute<R>(sql`
    SELECT 'r' || r.game_id || '-' || r.external_id AS id, r.external_id AS slug, NULL::int AS pct, 'rejected' AS mm, true AS nr, ${common}, NULL::int AS metascore
    FROM external_id_rejections r JOIN games g ON g.id = r.game_id WHERE r.source = ${METACRITIC_SOURCE} ORDER BY g.name`)).rows;
  const facts = await loadPageFacts([...new Set([...matched, ...removed].map((r) => r.slug))]);
  const igdbUrl = (s: string, id: number) => `https://www.igdb.com/games/${encodeURIComponent(s.endsWith(`-${id}`) ? s.slice(0, -`-${id}`.length) : s)}`;
  const rows: Row[] = [...matched, ...removed].map((r) => {
    const f = facts[r.slug];
    const rejected = r.mm === "rejected";
    const section: Row["section"] = rejected || r.mm === "manual" ? "done" : r.mm === "auto2" ? (r.nr ? "todo" : "skip") : "wait";
    return {
      id: r.id, gameId: r.gid, name: r.name, igdbUrl: igdbUrl(r.gslug, r.igdb_id), steamUrl: r.steam ? `https://store.steampowered.com/app/${r.steam}/` : null,
      mcSlug: r.slug, mcUrl: `https://www.metacritic.com/game/${r.slug}/`, mcTitle: f?.title ?? null, mcDate: f?.releaseDate ?? null, mcCompanies: f?.companies ?? [], mcFetched: !!f && f.state === "ok",
      ourDates: r.dates ?? [], ourFirstDate: r.first_date, ourCompanies: r.companies ?? [], ourPlatforms: r.platforms ?? [],
      confidence: r.pct, method: r.mm, needsReview: r.nr, metascore: r.metascore, section,
      checked: rejected ? false : r.mm === "manual" ? !r.nr : section === "skip",
    };
  });
  fs.writeFileSync(ROWS_FILE, JSON.stringify(rows));
  const count = (s: Row["section"]) => rows.filter((r) => r.section === s).length;
  console.log(`輸出 ${rows.length} 列 → ${ROWS_FILE}（不須校驗 ${count("skip")}、已完成 ${count("done")}、待校驗 ${count("todo")}、待下一輪 ${count("wait")}；缺 Metacritic 日期 ${rows.filter((r) => !r.mcDate).length}）`);
}

async function cmdApply(file: string): Promise<void> {
  const decisions = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, boolean>;
  const rows = JSON.parse(fs.readFileSync(ROWS_FILE, "utf8")) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stats = { confirmed: 0, rejected: 0, unchanged: 0, skipped: 0 };
  for (const row of rows) {
    if (row.section === "wait" || row.section === "done") {
      stats.skipped += 1;
      continue; // 待下一輪抓取、已完成的不套用
    }
    const want = decisions[row.id] ?? row.checked; // 沒有紀錄＝維持預設（不須校驗＝相符、待校驗＝不是同一部）
    if (row.section === "skip" && want) {
      stats.unchanged += 1;
      continue; // 不須校驗且沒被推翻：維持自動採用
    }
    const numeric = Number(row.id);
    if (want) {
      if (await confirmExternalMatch(numeric, METACRITIC_SOURCE)) stats.confirmed += 1;
    } else if (await rejectExternalMatch(numeric, METACRITIC_SOURCE, METACRITIC_SOURCE)) stats.rejected += 1;
  }
  void byId;
  console.log(`套用完成：確認相符 ${stats.confirmed}、拒絕 ${stats.rejected}、維持 ${stats.unchanged}、略過 ${stats.skipped}`);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  fs.mkdirSync(LOCAL, { recursive: true });
  if (cmd === "facts") await cmdFacts(Number(arg ?? 200));
  else if (cmd === "import-facts") await cmdImportFacts();
  else if (cmd === "export") await cmdExport();
  else if (cmd === "apply" && arg) await cmdApply(arg);
  else console.log("用法：facts [最多頁數] | import-facts | export | apply <decisions.json>");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
