import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { platforms } from "../schema";

export type Platform = typeof platforms.$inferSelect;
export type PlatformInput = typeof platforms.$inferInsert;

export async function getPlatformBySlug(slug: string, db: DbOrTx = getDb()): Promise<Platform | null> {
  const rows = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** 以 slug 為自然鍵 upsert（人工新增的主機沒有 igdbId）。完整平台同步在 Phase 2a。 */
export async function upsertPlatform(input: PlatformInput, db: DbOrTx = getDb()): Promise<Platform> {
  const [row] = await db
    .insert(platforms)
    .values(input)
    .onConflictDoUpdate({ target: platforms.slug, set: input })
    .returning();
  return row;
}
