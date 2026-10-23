import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { Game, GameInput } from "../domain/entities";
import { releaseGroupKey } from "../domain/game-group-keys";
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
  // 預先計算的日期分組鍵跟著首發日期／精度走（只在 input 有給其中之一時重算）
  const withGroup =
    "firstReleaseDate" in input || "firstReleasePrecision" in input
      ? { ...input, releaseGroup: releaseGroupKey(input.firstReleaseDate ?? null, input.firstReleasePrecision ?? null) }
      : input;
  const [row] = await db
    .insert(games)
    .values(withGroup)
    .onConflictDoUpdate({ target: games.igdbId, set: { ...withGroup, updatedAt: new Date() } })
    .returning();
  return row;
}

/** 滾動校對的對象：lastFullSyncAt 最舊的 N 款（從未完整同步的優先）。 */
export async function listGamesForRefresh(
  limit: number,
  db: DbOrTx = getDb(),
): Promise<Array<{ id: number; igdbId: number }>> {
  return db
    .select({ id: games.id, igdbId: games.igdbId })
    .from(games)
    .orderBy(sql`${games.lastFullSyncAt} ASC NULLS FIRST`, asc(games.id))
    .limit(limit);
}

/** 校對過但沒有寫入的遊戲（例如變成只上手機）也推進 lastFullSyncAt，避免每晚重複挑到。 */
export async function touchLastFullSync(gameIds: readonly number[], db: DbOrTx = getDb()): Promise<void> {
  if (gameIds.length === 0) return;
  await db.update(games).set({ lastFullSyncAt: new Date() }).where(inArray(games.id, [...gameIds]));
}
