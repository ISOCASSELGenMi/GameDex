/**
 * 帳號本人的設定、匯出讀取、刪除，以及管理員的停權操作（第 7 波；09 §隱私、匯出、刪除、12 §帳號停權）。
 * 刪除 users 列後，connected_accounts／sessions／auth_tokens／user_lists（→ user_list_games）／play_records／follows／calendar_feeds
 * 與 owned_games（經 connected_accounts）全部由 FK cascade 清除（migration 0007、0009、0010；整合測試逐表驗證）。
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { AccountPreferences, AccountPreferencesPatch } from "../domain/entities/account-self";
import { calendarFeeds, connectedAccounts, follows, ownedGames, playRecords, sessions, userListGames, userLists, users } from "../schema";

// ── 偏好 ──────────────────────────────────────────────────────────────────

const prefColumns = {
  displayName: users.displayName,
  locale: users.locale,
  timezone: users.timezone,
  preferredRegion: users.preferredRegion,
  scoreProviders: users.scoreProviders,
  preferredPlatformIds: users.preferredPlatformIds,
  defaultListVisibility: users.defaultListVisibility,
  defaultReviewVisibility: users.defaultReviewVisibility,
};

export async function findPreferences(userId: number): Promise<AccountPreferences | null> {
  const [row] = await getDb().select(prefColumns).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return { ...row, preferredPlatformIds: row.preferredPlatformIds ?? [] };
}

/** 套用偏好變更；沒有實際變更不寫入（updatedAt 不動）。回傳 null＝使用者不存在。 */
export async function updatePreferences(userId: number, patch: AccountPreferencesPatch): Promise<{ preferences: AccountPreferences; changed: boolean } | null> {
  const current = await findPreferences(userId);
  if (!current) return null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changedKeys = (Object.keys(patch) as Array<keyof AccountPreferences>).filter((k) => !same(patch[k], current[k]));
  if (changedKeys.length === 0) return { preferences: current, changed: false };
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  for (const k of changedKeys) (set as Record<string, unknown>)[k] = patch[k];
  await getDb().update(users).set(set).where(eq(users.id, userId));
  return { preferences: { ...current, ...patch }, changed: true };
}

// ── 刪除帳號 ───────────────────────────────────────────────────────────────

/** credential 列的密碼雜湊（沒有密碼的帳號回 null）。 */
export async function findCredentialPasswordHash(userId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ password: connectedAccounts.password })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "credential")))
    .limit(1);
  return row?.password ?? null;
}

/** 刪除使用者（其餘靠 cascade）。回傳是否刪到。 */
export async function deleteUserRow(userId: number): Promise<boolean> {
  const rows = await getDb().delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
}

// ── 停權 ──────────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: number;
  email: string;
  displayName: string;
  role: string;
  createdAt: Date;
  suspendedAt: Date | null;
  sessionCount: number;
}

const sessionCountExpr = sql<number>`(SELECT count(*)::int FROM ${sessions} WHERE ${sessions.userId} = ${users.id} AND ${sessions.expiresAt} > now())`;
const adminColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  createdAt: users.createdAt,
  suspendedAt: users.suspendedAt,
  sessionCount: sessionCountExpr,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 依 id（純數字）或信箱片段（不分大小寫）找使用者；沒給查詢＝最近停權的。 */
export async function searchUsersForAdmin(query: string | null, limit: number): Promise<AdminUserRow[]> {
  const db = getDb();
  const q = query?.trim() ?? "";
  if (q === "") return db.select(adminColumns).from(users).where(isNotNull(users.suspendedAt)).orderBy(desc(users.suspendedAt)).limit(limit);
  const conditions = [ilike(users.email, `%${escapeLike(q.toLowerCase())}%`)];
  if (/^\d{1,9}$/.test(q)) conditions.push(eq(users.id, Number(q)));
  return db.select(adminColumns).from(users).where(or(...conditions)).orderBy(asc(users.id)).limit(limit);
}

export async function findUserForAdmin(userId: number): Promise<AdminUserRow | null> {
  const [row] = await getDb().select(adminColumns).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

/** 停權（at 為時間）或解除（null）。回傳是否有使用者。停權時不改既有的 suspendedAt（重複停權冪等）。 */
export async function setSuspendedAt(userId: number, at: Date | null): Promise<{ found: boolean; changed: boolean }> {
  const [cur] = await getDb().select({ s: users.suspendedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!cur) return { found: false, changed: false };
  if ((cur.s !== null) === (at !== null)) return { found: true, changed: false };
  await getDb().update(users).set({ suspendedAt: at, updatedAt: new Date() }).where(eq(users.id, userId));
  return { found: true, changed: true };
}

/** 撤銷該使用者所有 session（強制登出）。回傳刪除筆數。 */
export async function deleteSessionsOfUser(userId: number): Promise<number> {
  const rows = await getDb().delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return rows.length;
}

// ── 匯出讀取（全量；每位使用者的資料量有上限：清單 100×1000、遊玩紀錄 5000） ──────────────

export async function readExportProfile(userId: number) {
  const [row] = await getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      emailVerified: users.emailVerified,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** 綁定的登入方式（含 credential；只有 provider 與時間，不含任何 token 或密碼）。 */
export async function readExportConnections(userId: number) {
  return getDb()
    .select({ provider: connectedAccounts.provider, connectedAt: connectedAccounts.connectedAt })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId))
    .orderBy(asc(connectedAccounts.connectedAt), asc(connectedAccounts.id));
}

/** 清單（不含 shareToken：它是分享連結的憑證，不屬於「資料」）。 */
export async function readExportLists(userId: number) {
  return getDb()
    .select({
      id: userLists.id,
      name: userLists.name,
      description: userLists.description,
      visibility: userLists.visibility,
      sortOrder: userLists.sortOrder,
      createdAt: userLists.createdAt,
      updatedAt: userLists.updatedAt,
    })
    .from(userLists)
    .where(eq(userLists.userId, userId))
    .orderBy(asc(userLists.sortOrder), asc(userLists.id));
}

export async function readExportListGames(listIds: readonly number[]) {
  if (listIds.length === 0) return [];
  return getDb()
    .select({ listId: userListGames.listId, gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt })
    .from(userListGames)
    .where(inArray(userListGames.listId, [...listIds]))
    .orderBy(asc(userListGames.listId), asc(userListGames.position), asc(userListGames.gameId));
}

export async function readExportPlayRecords(userId: number) {
  return getDb().select().from(playRecords).where(eq(playRecords.userId, userId)).orderBy(asc(playRecords.id));
}

export async function readExportFollows(userId: number) {
  return getDb()
    .select({ targetType: follows.targetType, targetId: follows.targetId, createdAt: follows.createdAt })
    .from(follows)
    .where(eq(follows.userId, userId))
    .orderBy(asc(follows.createdAt), asc(follows.targetType), asc(follows.targetId));
}

export async function readExportOwnedGames(userId: number) {
  return getDb()
    .select({
      provider: connectedAccounts.provider,
      externalGameId: ownedGames.externalGameId,
      externalTitle: ownedGames.externalTitle,
      matchedGameId: ownedGames.matchedGameId,
      matchConfidencePct: ownedGames.matchConfidencePct,
      matchMethod: ownedGames.matchMethod,
      importedAt: ownedGames.importedAt,
    })
    .from(ownedGames)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, ownedGames.connectedAccountId))
    .where(eq(connectedAccounts.userId, userId))
    .orderBy(asc(connectedAccounts.provider), asc(ownedGames.id));
}

/** 私人行事曆設定（有效的那個；**不選 tokenHash／tokenCiphertext**）。 */
export async function readExportActiveFeed(userId: number) {
  const [row] = await getDb()
    .select({
      name: calendarFeeds.name,
      locale: calendarFeeds.locale,
      feedType: calendarFeeds.feedType,
      includeReleases: calendarFeeds.includeReleases,
      includeEvents: calendarFeeds.includeEvents,
      filterPlatforms: calendarFeeds.filterPlatforms,
      filterRegions: calendarFeeds.filterRegions,
      filterGenres: calendarFeeds.filterGenres,
      filterStages: calendarFeeds.filterStages,
      createdAt: calendarFeeds.createdAt,
      lastAccessedAt: calendarFeeds.lastAccessedAt,
    })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.feedType, "following"), sql`${calendarFeeds.revokedAt} IS NULL`))
    .limit(1);
  return row ?? null;
}
