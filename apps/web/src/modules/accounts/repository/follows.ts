/**
 * 追蹤（follows）的查詢與寫入（09 §追蹤）。目標是否存在由 Use Case 先問 catalog（follows 沒有對 catalog 的 FK）。
 * 公開人數與熱度訊號一律排除停權帳號（users.suspended_at IS NOT NULL）。
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { FollowTarget, FollowTargetKey } from "../domain/entities/follows";
import { follows, users } from "../schema";

export interface FollowRow {
  targetType: FollowTarget;
  targetId: number;
  createdAt: Date;
}

/** 新增；已存在回 false（冪等）。 */
export async function insertFollow(userId: number, key: FollowTargetKey): Promise<boolean> {
  const rows = await getDb()
    .insert(follows)
    .values({ userId, targetType: key.targetType, targetId: key.targetId })
    .onConflictDoNothing()
    .returning({ id: follows.targetId });
  return rows.length > 0;
}

/** 刪除；原本就沒有回 false（冪等）。 */
export async function deleteFollow(userId: number, key: FollowTargetKey): Promise<boolean> {
  const rows = await getDb()
    .delete(follows)
    .where(and(eq(follows.userId, userId), eq(follows.targetType, key.targetType), eq(follows.targetId, key.targetId)))
    .returning({ id: follows.targetId });
  return rows.length > 0;
}

export async function followExists(userId: number, key: FollowTargetKey): Promise<boolean> {
  const rows = await getDb()
    .select({ id: follows.targetId })
    .from(follows)
    .where(and(eq(follows.userId, userId), eq(follows.targetType, key.targetType), eq(follows.targetId, key.targetId)))
    .limit(1);
  return rows.length > 0;
}

/** 這位使用者在 since 之後新增的追蹤數（每日上限用；滾動視窗）。 */
export async function countFollowsSince(userId: number, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(and(eq(follows.userId, userId), gte(follows.createdAt, since)));
  return row?.n ?? 0;
}

/** 本人的追蹤清單（新到舊）。多取一筆判斷 hasMore。 */
export async function listFollows(
  userId: number,
  opts: { targetType?: FollowTarget; limit: number; offset: number },
): Promise<{ rows: FollowRow[]; hasMore: boolean }> {
  const where = opts.targetType
    ? and(eq(follows.userId, userId), eq(follows.targetType, opts.targetType))
    : eq(follows.userId, userId);
  const rows = await getDb()
    .select({ targetType: follows.targetType, targetId: follows.targetId, createdAt: follows.createdAt })
    .from(follows)
    .where(where)
    .orderBy(desc(follows.createdAt), desc(follows.targetId))
    .limit(opts.limit + 1)
    .offset(opts.offset);
  return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

/** 本人追蹤的所有目標 id，依種類分組（私人 iCal、mine 篩選用）。 */
export async function listFollowedIds(userId: number): Promise<Record<FollowTarget, number[]>> {
  const rows = await getDb()
    .select({ targetType: follows.targetType, targetId: follows.targetId })
    .from(follows)
    .where(eq(follows.userId, userId))
    .orderBy(follows.targetType, follows.targetId);
  const out: Record<FollowTarget, number[]> = { game: [], event: [], platform: [], franchise: [], company: [] };
  for (const r of rows) out[r.targetType].push(r.targetId);
  return out;
}

/** 本人在這些目標之中追蹤了哪些。 */
export async function findFollowed(userId: number, keys: readonly FollowTargetKey[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (keys.length === 0) return out;
  const res = await getDb().execute<{ target_type: FollowTarget; target_id: number }>(sql`
    SELECT f.target_type, f.target_id FROM follows f
    JOIN unnest(${pgTextArray(keys.map((k) => k.targetType))}::follow_target[], ${pgIntArray(keys.map((k) => k.targetId))}::int[]) AS k(t, i)
      ON k.t = f.target_type AND k.i = f.target_id
    WHERE f.user_id = ${userId}
  `);
  for (const r of res.rows) out.add(`${r.target_type}:${Number(r.target_id)}`);
  return out;
}

/** 這些目標的公開追蹤人數（排除停權帳號）；沒有人追蹤的不在 Map（key＝`type:id`）。 */
export async function countFollowers(keys: readonly FollowTargetKey[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const res = await getDb().execute<{ target_type: FollowTarget; target_id: number; n: number }>(sql`
    SELECT f.target_type, f.target_id, count(*)::int AS n
    FROM follows f
    JOIN unnest(${pgTextArray(keys.map((k) => k.targetType))}::follow_target[], ${pgIntArray(keys.map((k) => k.targetId))}::int[]) AS k(t, i)
      ON k.t = f.target_type AND k.i = f.target_id
    JOIN users u ON u.id = f.user_id
    WHERE u.suspended_at IS NULL
    GROUP BY f.target_type, f.target_id
  `);
  for (const r of res.rows) out.set(`${r.target_type}:${Number(r.target_id)}`, Number(r.n));
  return out;
}

export interface SignalRow {
  gameId: number;
  value: number;
}

/**
 * 熱度訊號（PopularitySignal）：遊戲的追蹤人數；sinceDays 給了＝只算近 N 天內新增的。
 * 排除停權帳號；gameIds 省略＝全部。value 一律 > 0（沒人追蹤的遊戲不回）。
 */
export async function countGameFollowsBySignal(opts: { sinceDays?: number; gameIds?: readonly number[] }): Promise<SignalRow[]> {
  const conds = [sql`f.target_type = 'game'`, sql`u.suspended_at IS NULL`];
  if (opts.sinceDays !== undefined) conds.push(sql`f.created_at >= now() - make_interval(days => ${opts.sinceDays}::int)`);
  if (opts.gameIds) conds.push(sql`f.target_id = ANY(${pgIntArray(opts.gameIds)}::int[])`);
  const res = await getDb().execute<{ game_id: number; n: number }>(sql`
    SELECT f.target_id AS game_id, count(*)::int AS n
    FROM follows f JOIN users u ON u.id = f.user_id
    WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY f.target_id
  `);
  return res.rows.map((r) => ({ gameId: Number(r.game_id), value: Number(r.n) }));
}

/** 某種類目前被追蹤的所有不同目標 id（孤兒清理用）。 */
export async function listDistinctTargetIds(type: FollowTarget): Promise<number[]> {
  const rows = await getDb().selectDistinct({ id: follows.targetId }).from(follows).where(eq(follows.targetType, type)).orderBy(follows.targetId);
  return rows.map((r) => r.id);
}

/** 刪除指向這些目標的所有追蹤列；回傳刪除筆數。 */
export async function deleteFollowsByTarget(type: FollowTarget, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await getDb()
    .delete(follows)
    .where(and(eq(follows.targetType, type), inArray(follows.targetId, [...ids])))
    .returning({ id: follows.targetId });
  return rows.length;
}

/** 未停權的追蹤者人數（單一目標；測試與公開人數 API 的簡化版）。 */
export async function countFollowersOf(key: FollowTargetKey): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.userId))
    .where(and(eq(follows.targetType, key.targetType), eq(follows.targetId, key.targetId), sql`${users.suspendedAt} IS NULL`));
  return row?.n ?? 0;
}

// pg 陣列字面量（node-postgres 會把 JS 陣列轉成 Postgres 陣列，但 drizzle 的 sql 範本不會；統一轉成 `{a,b}` 字串再 cast）
function pgIntArray(values: readonly number[]) {
  return sql`${`{${values.join(",")}}`}`;
}
function pgTextArray(values: readonly string[]) {
  return sql`${`{${values.join(",")}}`}`;
}
