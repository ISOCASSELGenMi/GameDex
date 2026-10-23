/**
 * 彩蛋解鎖紀錄（user_unlocks）與「帳號資料可判定的成就」證據查詢（Z3B）。
 * 合併規則：同一 (user, type, key) 取較早的 unlocked_at（ON CONFLICT DO UPDATE SET unlocked_at = LEAST(...)）。
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { UnlockType, UnlockView } from "../domain/entities/unlocks";
import { calendarFeeds, follows, userLists, userUnlocks } from "../schema";

export async function listUnlocks(userId: number): Promise<UnlockView[]> {
  const rows = await getDb()
    .select({ type: userUnlocks.type, key: userUnlocks.key, at: userUnlocks.unlockedAt })
    .from(userUnlocks)
    .where(eq(userUnlocks.userId, userId))
    .orderBy(userUnlocks.type, userUnlocks.key);
  return rows.map((r) => ({ type: r.type, key: r.key, at: r.at.toISOString() }));
}

/** 批次 upsert（同 key 取較早時間）。 */
export async function upsertUnlocks(userId: number, items: ReadonlyArray<{ type: UnlockType; key: string; at: Date }>): Promise<void> {
  if (items.length === 0) return;
  await getDb()
    .insert(userUnlocks)
    .values(items.map((i) => ({ userId, type: i.type, key: i.key, unlockedAt: i.at })))
    .onConflictDoUpdate({
      target: [userUnlocks.userId, userUnlocks.type, userUnlocks.key],
      set: { unlockedAt: sql`LEAST(${userUnlocks.unlockedAt}, EXCLUDED.unlocked_at)` },
    });
}

/** 帳號資料的成就證據：各項最早的時間（沒有為 null）。 */
export async function readAchievementEvidence(userId: number): Promise<{ firstFollowAt: Date | null; firstListAt: Date | null; firstFeedAt: Date | null }> {
  const db = getDb();
  const [f] = await db.select({ at: sql<Date | null>`min(${follows.createdAt})` }).from(follows).where(eq(follows.userId, userId));
  const [l] = await db.select({ at: sql<Date | null>`min(${userLists.createdAt})` }).from(userLists).where(eq(userLists.userId, userId));
  const [c] = await db.select({ at: sql<Date | null>`min(${calendarFeeds.createdAt})` }).from(calendarFeeds).where(eq(calendarFeeds.userId, userId));
  const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
  return { firstFollowAt: d(f?.at), firstListAt: d(l?.at), firstFeedAt: d(c?.at) };
}
