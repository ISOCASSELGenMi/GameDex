import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";

export interface SlugRow {
  slug: string;
  nameNorm: string;
}

/** 批次寫入 slug 索引（已存在的略過）。回傳新增筆數。 */
export async function insertSlugs(rows: readonly SlugRow[], db: DbOrTx = getDb()): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await db.execute(sql`
      INSERT INTO metacritic_slugs (slug, name_norm)
      VALUES ${sql.join(chunk.map((r) => sql`(${r.slug}, ${r.nameNorm})`), sql`, `)}
      ON CONFLICT (slug) DO NOTHING`);
    added += res.rowCount ?? 0;
  }
  return added;
}

export async function countSlugs(db: DbOrTx = getDb()): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM metacritic_slugs`);
  return Number(res.rows[0]?.n ?? 0);
}

/** 與正規化名稱最像的 slug（pg_trgm 相似度，門檻 0.3）。 */
export async function searchSlugs(nameNorm: string, limit: number, db: DbOrTx = getDb()): Promise<SlugRow[]> {
  if (nameNorm === "") return [];
  const res = await db.execute<{ slug: string; name_norm: string }>(sql`
    SELECT slug, name_norm FROM metacritic_slugs
    WHERE name_norm % ${nameNorm}
    ORDER BY similarity(name_norm, ${nameNorm}) DESC, slug ASC
    LIMIT ${Math.max(1, Math.min(limit, 50))}`);
  return res.rows.map((r) => ({ slug: r.slug, nameNorm: r.name_norm }));
}
