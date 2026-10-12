import { asc, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { Region } from "../domain/entities";
import { regions } from "../schema";

export async function listRegions(db: DbOrTx = getDb()): Promise<Region[]> {
  return db.select().from(regions).orderBy(asc(regions.id));
}

export async function getRegionByCode(code: string, db: DbOrTx = getDb()): Promise<Region | null> {
  const rows = await db.select().from(regions).where(eq(regions.code, code)).limit(1);
  return rows[0] ?? null;
}

/** 冪等：已存在的 code 只更新名稱。 */
export async function upsertRegions(items: ReadonlyArray<Omit<Region, "id">>, db: DbOrTx = getDb()): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await db
    .insert(regions)
    .values([...items])
    .onConflictDoUpdate({ target: regions.code, set: { name: sql`excluded.name` } })
    .returning({ id: regions.id });
  return rows.length;
}
