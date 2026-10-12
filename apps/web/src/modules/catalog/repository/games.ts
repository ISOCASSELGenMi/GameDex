import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { Game, GameInput } from "../domain/entities";
import { games } from "../schema";

export async function getGameBySlug(slug: string, db: DbOrTx = getDb()): Promise<Game | null> {
  const rows = await db.select().from(games).where(eq(games.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getGameByIgdbId(igdbId: number, db: DbOrTx = getDb()): Promise<Game | null> {
  const rows = await db.select().from(games).where(eq(games.igdbId, igdbId)).limit(1);
  return rows[0] ?? null;
}

/** 以 igdbId 為自然鍵 upsert；只覆寫 input 有給的欄位。 */
export async function upsertGame(input: GameInput, db: DbOrTx = getDb()): Promise<Game> {
  const [row] = await db
    .insert(games)
    .values(input)
    .onConflictDoUpdate({ target: games.igdbId, set: { ...input, updatedAt: new Date() } })
    .returning();
  return row;
}
