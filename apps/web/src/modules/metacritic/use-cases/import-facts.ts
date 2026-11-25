/** 一次性匯入：舊側檔 .local/metacritic-facts.json 的列轉成 metacritic_pages（冪等；已存在的列不覆蓋）。 */
import { importFacts } from "../repository/pages";
import { pageExpiresAt } from "./pages";

export interface ImportedFacts {
  title: string | null;
  releaseDate: string | null;
  companies: readonly string[];
  platforms: readonly string[];
  fetchedAt: string;
  state: "ok" | "not_found";
}

/** 回傳新增筆數（無效的 fetchedAt 略過）。releaseYear 取發售日的年份。 */
export async function importPageFacts(map: Record<string, ImportedFacts>): Promise<{ total: number; added: number; skipped: number }> {
  const rows = [];
  let skipped = 0;
  for (const [slug, f] of Object.entries(map)) {
    const fetchedAt = new Date(f.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime()) || (f.state !== "ok" && f.state !== "not_found")) {
      skipped += 1;
      continue;
    }
    const ok = f.state === "ok";
    rows.push({
      slug,
      state: f.state,
      title: ok ? f.title : null,
      releaseDate: ok ? f.releaseDate : null,
      releaseYear: ok && f.releaseDate ? Number(f.releaseDate.slice(0, 4)) : null,
      companies: ok ? [...f.companies] : [],
      platforms: ok ? [...f.platforms] : [],
      fetchedAt,
      expiresAt: pageExpiresAt(f.state, ok ? f.releaseDate : null, fetchedAt),
    });
  }
  return { total: Object.keys(map).length, added: await importFacts(rows), skipped };
}
