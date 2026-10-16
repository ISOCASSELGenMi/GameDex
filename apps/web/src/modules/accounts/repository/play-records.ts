/**
 * 遊玩紀錄（play_records）與玩家平均（game_player_ratings）的查詢與寫入（09 §遊玩紀錄）。
 * 玩家平均的彙整是單一 SQL（refreshPlayerRatings）：全量重算、一個 statement 內完成 upsert 與刪除。
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import { FINISHED_STATUSES, PLAY_STATUSES, type PlayStatus, type PlayStatsView, type ReviewVisibility } from "../domain/entities/play-records";
import { gamePlayerRatings, playRecords, users } from "../schema";

export interface PlayRecordRow {
  id: number;
  userId: number;
  gameId: number;
  platformId: number | null;
  status: PlayStatus;
  startedOn: string | null;
  finishedOn: string | null;
  playMinutes: number | null;
  ratingHalfSteps: number | null;
  review: string | null;
  reviewHasSpoilers: boolean;
  reviewVisibility: ReviewVisibility;
  privateNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: playRecords.id,
  userId: playRecords.userId,
  gameId: playRecords.gameId,
  platformId: playRecords.platformId,
  status: playRecords.status,
  startedOn: playRecords.startedOn,
  finishedOn: playRecords.finishedOn,
  playMinutes: playRecords.playMinutes,
  ratingHalfSteps: playRecords.ratingHalfSteps,
  review: playRecords.review,
  reviewHasSpoilers: playRecords.reviewHasSpoilers,
  reviewVisibility: playRecords.reviewVisibility,
  privateNote: playRecords.privateNote,
  createdAt: playRecords.createdAt,
  updatedAt: playRecords.updatedAt,
};

export async function countPlayRecords(userId: number): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(playRecords).where(eq(playRecords.userId, userId));
  return row?.n ?? 0;
}

export type PlayRecordWrite = Omit<PlayRecordRow, "id" | "userId" | "createdAt" | "updatedAt">;

export async function insertPlayRecord(userId: number, v: PlayRecordWrite): Promise<PlayRecordRow> {
  const [row] = await getDb().insert(playRecords).values({ userId, ...v }).returning(cols);
  return row!;
}

export async function findPlayRecord(userId: number, id: number): Promise<PlayRecordRow | null> {
  const [row] = await getDb().select(cols).from(playRecords).where(and(eq(playRecords.id, id), eq(playRecords.userId, userId))).limit(1);
  return row ?? null;
}

export async function updatePlayRecord(userId: number, id: number, patch: Partial<PlayRecordWrite>): Promise<PlayRecordRow | null> {
  const [row] = await getDb()
    .update(playRecords)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(playRecords.id, id), eq(playRecords.userId, userId)))
    .returning(cols);
  return row ?? null;
}

export async function deletePlayRecord(userId: number, id: number): Promise<boolean> {
  const res = await getDb().delete(playRecords).where(and(eq(playRecords.id, id), eq(playRecords.userId, userId))).returning({ id: playRecords.id });
  return res.length > 0;
}

/** 本人的紀錄，最近更新在前。 */
export async function listPlayRecords(
  userId: number,
  opts: { gameId?: number; limit: number; offset: number },
): Promise<{ rows: PlayRecordRow[]; hasMore: boolean }> {
  const where = opts.gameId === undefined ? eq(playRecords.userId, userId) : and(eq(playRecords.userId, userId), eq(playRecords.gameId, opts.gameId));
  const rows = await getDb()
    .select(cols)
    .from(playRecords)
    .where(where)
    .orderBy(desc(playRecords.updatedAt), desc(playRecords.id))
    .limit(opts.limit + 1)
    .offset(opts.offset);
  return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

/** 個人統計（即時聚合）。year＝UTC 年份。 */
export async function playStatsForUser(userId: number, year: number): Promise<PlayStatsView> {
  const finished = sql.join(FINISHED_STATUSES.map((s) => sql`${s}`), sql`, `);
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      minutes: sql<number>`COALESCE(sum(${playRecords.playMinutes}), 0)::bigint`,
      thisYear: sql<number>`(count(*) FILTER (WHERE ${playRecords.status}::text IN (${finished}) AND ${playRecords.finishedOn} IS NOT NULL AND EXTRACT(YEAR FROM ${playRecords.finishedOn}) = ${year}))::int`,
    })
    .from(playRecords)
    .where(eq(playRecords.userId, userId));
  const grouped = await getDb()
    .select({ status: playRecords.status, n: sql<number>`count(*)::int` })
    .from(playRecords)
    .where(eq(playRecords.userId, userId))
    .groupBy(playRecords.status);
  const byStatus = Object.fromEntries(PLAY_STATUSES.map((s) => [s, 0])) as Record<PlayStatus, number>;
  for (const g of grouped) byStatus[g.status] = g.n;
  return { byStatus, total: row?.total ?? 0, finishedThisYear: row?.thisYear ?? 0, year, totalPlayMinutes: Number(row?.minutes ?? 0) };
}

// ── 玩家平均 ──────────────────────────────────────────────────────────────

export interface PlayerRatingRow {
  ratingCount: number;
  avgHalfSteps: number | null;
  avgPlayMinutes: number | null;
}

export async function findPlayerRating(gameId: number): Promise<PlayerRatingRow | null> {
  const [row] = await getDb().select().from(gamePlayerRatings).where(eq(gamePlayerRatings.gameId, gameId)).limit(1);
  if (!row) return null;
  return { ratingCount: row.ratingCount, avgHalfSteps: row.avgHalfSteps === null ? null : Number(row.avgHalfSteps), avgPlayMinutes: row.avgPlayMinutes };
}

/**
 * 全量重算玩家平均（D68）：
 * - 一人一票：每款遊戲、每位未停權用戶，取「最新一筆有評分」的紀錄（updated_at DESC, id DESC）。
 * - 平均耗時：每位用戶最新一筆「有耗時且狀態為 finished／completed」的紀錄，平均後四捨五入。
 * - 兩者都沒有資料的遊戲刪列；只有資料變動的列才寫入（updated_at 為資料最後變動時間）。
 * 單一 statement（data-modifying CTE），upsert 與刪除原子完成。
 */
export async function refreshPlayerRatings(): Promise<{ upserted: number; deleted: number }> {
  const finished = sql.join(FINISHED_STATUSES.map((s) => sql`${s}`), sql`, `);
  const res = await getDb().execute<{ upserted: number; deleted: number }>(sql`
    WITH latest_rated AS (
      SELECT DISTINCT ON (pr.game_id, pr.user_id) pr.game_id, pr.user_id, pr.rating_half_steps
      FROM ${playRecords} pr JOIN ${users} u ON u.id = pr.user_id AND u.suspended_at IS NULL
      WHERE pr.rating_half_steps IS NOT NULL
      ORDER BY pr.game_id, pr.user_id, pr.updated_at DESC, pr.id DESC
    ), ratings AS (
      SELECT game_id, avg(rating_half_steps)::numeric(4,2) AS avg_hs, count(*)::int AS cnt FROM latest_rated GROUP BY game_id
    ), latest_time AS (
      SELECT DISTINCT ON (pr.game_id, pr.user_id) pr.game_id, pr.user_id, pr.play_minutes
      FROM ${playRecords} pr JOIN ${users} u ON u.id = pr.user_id AND u.suspended_at IS NULL
      WHERE pr.play_minutes IS NOT NULL AND pr.status::text IN (${finished})
      ORDER BY pr.game_id, pr.user_id, pr.updated_at DESC, pr.id DESC
    ), times AS (
      SELECT game_id, round(avg(play_minutes))::int AS avg_min FROM latest_time GROUP BY game_id
    ), agg AS (
      SELECT COALESCE(r.game_id, t.game_id) AS game_id, r.avg_hs, COALESCE(r.cnt, 0) AS cnt, t.avg_min
      FROM ratings r FULL JOIN times t ON t.game_id = r.game_id
    ), up AS (
      INSERT INTO ${gamePlayerRatings} (game_id, avg_half_steps, rating_count, avg_play_minutes, updated_at)
      SELECT game_id, avg_hs, cnt, avg_min, now() FROM agg
      ON CONFLICT (game_id) DO UPDATE
        SET avg_half_steps = EXCLUDED.avg_half_steps, rating_count = EXCLUDED.rating_count,
            avg_play_minutes = EXCLUDED.avg_play_minutes, updated_at = now()
        WHERE ${gamePlayerRatings}.avg_half_steps IS DISTINCT FROM EXCLUDED.avg_half_steps
           OR ${gamePlayerRatings}.rating_count IS DISTINCT FROM EXCLUDED.rating_count
           OR ${gamePlayerRatings}.avg_play_minutes IS DISTINCT FROM EXCLUDED.avg_play_minutes
      RETURNING 1
    ), del AS (
      DELETE FROM ${gamePlayerRatings} WHERE game_id NOT IN (SELECT game_id FROM agg) RETURNING 1
    )
    SELECT (SELECT count(*) FROM up)::int AS upserted, (SELECT count(*) FROM del)::int AS deleted`);
  const r = res.rows[0];
  return { upserted: Number(r?.upserted ?? 0), deleted: Number(r?.deleted ?? 0) };
}
