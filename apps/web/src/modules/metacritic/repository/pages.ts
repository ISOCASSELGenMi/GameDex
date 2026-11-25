import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import { metacriticPages } from "../schema";

export type PageRow = typeof metacriticPages.$inferSelect;
export type PageRowInput = typeof metacriticPages.$inferInsert;

export async function getPage(slug: string): Promise<PageRow | null> {
  const rows = await getDb().select().from(metacriticPages).where(eq(metacriticPages.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getPagesBySlugs(slugs: readonly string[]): Promise<PageRow[]> {
  if (slugs.length === 0) return [];
  const out: PageRow[] = [];
  for (let i = 0; i < slugs.length; i += 1000) out.push(...(await getDb().select().from(metacriticPages).where(inArray(metacriticPages.slug, slugs.slice(i, i + 1000)))));
  return out;
}

/** 寫入或覆蓋一列（實際發請求後的寫穿）。 */
export async function upsertPage(row: PageRowInput): Promise<void> {
  await getDb().insert(metacriticPages).values(row).onConflictDoUpdate({ target: metacriticPages.slug, set: { ...row, slug: undefined } });
}

/** 批次匯入（舊側檔轉入）：已存在的列不覆蓋（資料庫裡的一定比舊檔新）；回傳新增筆數。冪等。 */
export async function importFacts(rows: readonly PageRowInput[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await getDb().insert(metacriticPages).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ slug: metacriticPages.slug });
    added += res.length;
  }
  return added;
}
