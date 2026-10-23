import { and, asc, eq, isNull, sql } from "drizzle-orm";
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

/** 站內玩家平均在 ratings 表的識別（評分排名頁的 `players` 欄；accounts 的排程任務寫入）。 */
export const SITE_PLAYERS_PROVIDER = "site_players";
export const SITE_PLAYERS_SCORE_TYPE = "user_average";
export const SITE_PLAYERS_ORIGIN = "site-players";

export interface SitePlayerRatingInput {
  gameId: number;
  /** 0~100 整數（玩家平均 8.5／10 → 85）。 */
  score: number;
  /** 計入的人數。 */
  reviewCount: number;
}

/**
 * 以 entries 整批取代 `site_players` 的列（一個 statement、原子完成）：
 * - 有的 upsert（分數或人數沒變就不寫，fetched_at 也不動）；不存在的遊戲 id 略過。
 * - 不在 entries 裡的舊列刪除（人數降到門檻以下、玩家紀錄被刪、停權者讓平均變動時，舊值要消失）。
 * 不寫 score_snapshots（歷史走勢只對外部來源有意義）。entries 為空＝刪光。
 */
export async function replaceSitePlayerRatings(
  entries: readonly SitePlayerRatingInput[],
  db: DbOrTx = getDb(),
): Promise<{ upserted: number; deleted: number }> {
  const ids = entries.map((e) => e.gameId);
  const scores = entries.map((e) => e.score);
  const counts = entries.map((e) => e.reviewCount);
  const res = await db.execute<{ upserted: number; deleted: number }>(sql`
    WITH input AS (
      SELECT * FROM unnest(${sql.param(ids)}::int[], ${sql.param(scores)}::int[], ${sql.param(counts)}::int[]) AS t(game_id, score, cnt)
    ), up AS (
      INSERT INTO ratings (game_id, platform_id, score_origin, score_provider, score_type, score, score_max, review_count, fetched_at)
      SELECT i.game_id, NULL, ${SITE_PLAYERS_ORIGIN}, ${SITE_PLAYERS_PROVIDER}::score_provider, ${SITE_PLAYERS_SCORE_TYPE}, i.score, 100, i.cnt, now()
      FROM input i JOIN games g ON g.id = i.game_id
      ON CONFLICT (game_id, platform_id, score_provider, score_type) DO UPDATE
        SET score = EXCLUDED.score, review_count = EXCLUDED.review_count, score_origin = EXCLUDED.score_origin, fetched_at = now()
        WHERE ratings.score IS DISTINCT FROM EXCLUDED.score OR ratings.review_count IS DISTINCT FROM EXCLUDED.review_count
      RETURNING 1
    ), del AS (
      DELETE FROM ratings r
      WHERE r.score_provider = ${SITE_PLAYERS_PROVIDER}::score_provider AND r.score_type = ${SITE_PLAYERS_SCORE_TYPE}
        AND NOT EXISTS (SELECT 1 FROM input i WHERE i.game_id = r.game_id)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM up)::int AS upserted, (SELECT count(*) FROM del)::int AS deleted`);
  const r = res.rows[0];
  return { upserted: Number(r?.upserted ?? 0), deleted: Number(r?.deleted ?? 0) };
}
