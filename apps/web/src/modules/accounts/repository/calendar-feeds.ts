/**
 * 私人 iCal 訂閱 feed（calendar_feeds）的查詢與寫入（08 §私人 feed、03）。
 * token 本身不在這裡產生、也不在這裡解密：Use Case 負責（token-cipher 是 accounts 的 providers）。
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { FeedPatchInput, FeedType } from "../domain/entities/calendar-feeds";
import { calendarFeeds } from "../schema";

export interface FeedRow {
  id: number;
  userId: number;
  tokenHash: string;
  tokenCiphertext: string | null;
  name: string;
  locale: string;
  settingsVersion: number;
  feedType: FeedType;
  filterPlatforms: number[];
  filterRegions: number[];
  filterGenres: string[];
  filterStages: string[];
  includeReleases: boolean;
  includeEvents: boolean;
  createdAt: Date;
  lastAccessedAt: Date | null;
  revokedAt: Date | null;
}

const columns = {
  id: calendarFeeds.id,
  userId: calendarFeeds.userId,
  tokenHash: calendarFeeds.tokenHash,
  tokenCiphertext: calendarFeeds.tokenCiphertext,
  name: calendarFeeds.name,
  locale: calendarFeeds.locale,
  settingsVersion: calendarFeeds.settingsVersion,
  feedType: calendarFeeds.feedType,
  filterPlatforms: calendarFeeds.filterPlatforms,
  filterRegions: calendarFeeds.filterRegions,
  filterGenres: calendarFeeds.filterGenres,
  filterStages: calendarFeeds.filterStages,
  includeReleases: calendarFeeds.includeReleases,
  includeEvents: calendarFeeds.includeEvents,
  createdAt: calendarFeeds.createdAt,
  lastAccessedAt: calendarFeeds.lastAccessedAt,
  revokedAt: calendarFeeds.revokedAt,
};

export async function findActiveFollowingFeed(userId: number): Promise<FeedRow | null> {
  const [row] = await getDb()
    .select(columns)
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.feedType, "following"), isNull(calendarFeeds.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function findFeedByTokenHash(tokenHash: string): Promise<FeedRow | null> {
  const [row] = await getDb().select(columns).from(calendarFeeds).where(eq(calendarFeeds.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function findOwnedFeed(userId: number, feedId: number): Promise<FeedRow | null> {
  const [row] = await getDb()
    .select(columns)
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** 這位使用者在 since 之後建立的 feed 列數（含已撤銷的；建立／重新產生的 rate limit 用）。 */
export async function countFeedsCreatedSince(userId: number, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), gte(calendarFeeds.createdAt, since)));
  return row?.n ?? 0;
}

export interface NewFeed {
  tokenHash: string;
  tokenCiphertext: string;
  name: string;
  locale: string;
}

/** 新增 following feed；使用者已有有效的 following feed（partial unique）→ null（並發建立時另一邊贏了）。 */
export async function insertFollowingFeed(userId: number, feed: NewFeed): Promise<FeedRow | null> {
  const [created] = await getDb()
    .insert(calendarFeeds)
    .values({ userId, feedType: "following", ...feed })
    .onConflictDoNothing()
    .returning({ id: calendarFeeds.id });
  if (!created) return null;
  return findOwnedFeed(userId, created.id);
}

/** 更新設定；`bump`＝settingsVersion + 1。找不到（或不是本人的、已撤銷的）→ null。 */
export async function updateFeedSettings(userId: number, feedId: number, patch: FeedPatchInput, bump: boolean): Promise<FeedRow | null> {
  const rows = await getDb()
    .update(calendarFeeds)
    .set({
      ...patch,
      ...(bump ? { settingsVersion: sql`${calendarFeeds.settingsVersion} + 1` } : {}),
    })
    .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)))
    .returning({ id: calendarFeeds.id });
  if (rows.length === 0) return null;
  return findOwnedFeed(userId, feedId);
}

/**
 * 重新產生：同一個 transaction 內把舊列標 revoked_at、新增一列（沿用名稱、語系、篩選、include*；settingsVersion + 1）。
 * 舊列不存在、不是本人的、已撤銷 → null。
 */
export async function rotateFeed(userId: number, feedId: number, next: { tokenHash: string; tokenCiphertext: string }, now: Date): Promise<FeedRow | null> {
  return getDb().transaction(async (tx) => {
    const [old] = await tx
      .select(columns)
      .from(calendarFeeds)
      .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)))
      .for("update")
      .limit(1);
    if (!old) return null;
    await tx.update(calendarFeeds).set({ revokedAt: now }).where(eq(calendarFeeds.id, old.id));
    const [created] = await tx
      .insert(calendarFeeds)
      .values({
        userId,
        feedType: old.feedType,
        tokenHash: next.tokenHash,
        tokenCiphertext: next.tokenCiphertext,
        name: old.name,
        locale: old.locale,
        settingsVersion: old.settingsVersion + 1,
        filterPlatforms: old.filterPlatforms,
        filterRegions: old.filterRegions,
        filterGenres: old.filterGenres,
        filterStages: old.filterStages,
        includeReleases: old.includeReleases,
        includeEvents: old.includeEvents,
      })
      .returning(columns);
    return created ?? null;
  });
}

/** 更新最後存取時間（節流）：從未存取過、或距離上次寫入已超過 intervalMs 才寫。回傳是否寫入。 */
export async function touchFeedAccess(feedId: number, now: Date, intervalMs: number): Promise<boolean> {
  const rows = await getDb()
    .update(calendarFeeds)
    .set({ lastAccessedAt: now })
    .where(
      and(
        eq(calendarFeeds.id, feedId),
        sql`(${calendarFeeds.lastAccessedAt} IS NULL OR ${calendarFeeds.lastAccessedAt} < ${new Date(now.getTime() - intervalMs)})`,
      ),
    )
    .returning({ id: calendarFeeds.id });
  return rows.length > 0;
}
