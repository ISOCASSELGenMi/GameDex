import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { Rating, RatingInput } from "../domain/entities";
import { ratings, scoreSnapshots } from "../schema";

export async function getRatingsByGame(gameId: number, db: DbOrTx = getDb()): Promise<Rating[]> {
  return db.select().from(ratings).where(eq(ratings.gameId, gameId)).orderBy(asc(ratings.id));
}

/**
 * 依 (game, platform, provider, type) upsert（UNIQUE NULLS NOT DISTINCT，platformId 可為 NULL）。
 * 分數或評論數變動才寫 score_snapshots。
 * 「分數 0 不寫」等來源規則由 Use Case 處理（04、05）。
 */
export async function upsertRating(input: RatingInput, db: DbOrTx = getDb()): Promise<Rating> {
  const platformId = input.platformId ?? null;
  const scoreType = input.scoreType ?? "critic_aggregate";
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ score: ratings.score, reviewCount: ratings.reviewCount })
      .from(ratings)
      .where(
        and(
          eq(ratings.gameId, input.gameId),
          platformId === null ? isNull(ratings.platformId) : eq(ratings.platformId, platformId),
          eq(ratings.scoreProvider, input.scoreProvider),
          eq(ratings.scoreType, scoreType),
        ),
      )
      .limit(1);

    const values = { ...input, platformId, scoreType };
    const [row] = await tx
      .insert(ratings)
      .values(values)
      .onConflictDoUpdate({
        target: [ratings.gameId, ratings.platformId, ratings.scoreProvider, ratings.scoreType],
        set: {
          scoreOrigin: values.scoreOrigin,
          score: values.score ?? null,
          scoreMax: values.scoreMax ?? 100,
          reviewCount: values.reviewCount ?? null,
          sourceUrl: values.sourceUrl ?? null,
          nextRefreshAt: values.nextRefreshAt ?? null,
          fetchedAt: new Date(),
        },
      })
      .returning();

    const changed = !before || before.score !== row.score || before.reviewCount !== row.reviewCount;
    if (changed) {
      await tx.insert(scoreSnapshots).values({ ratingId: row.id, score: row.score, reviewCount: row.reviewCount });
    }
    return row;
  });
}
