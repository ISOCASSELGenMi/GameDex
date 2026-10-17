/**
 * 收藏清單（user_lists、user_list_games）的查詢與寫入（09 §收藏清單）。權限判斷（誰能讀）在 Use Case，這裡只做資料存取。
 * 遊戲是否存在由 Use Case 先問 catalog；這裡的 FK（migration 手寫）是最後一道。
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { ListVisibility } from "../domain/entities/lists";
import { userListGames, userLists, users } from "../schema";

export interface ListRow {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  visibility: ListVisibility;
  shareToken: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  gameCount: number;
}

export interface ListWithOwner extends ListRow {
  owner: { displayName: string; handle: string | null; avatarUrl: string | null; suspended: boolean };
}

const gameCountExpr = sql<number>`(SELECT count(*)::int FROM ${userListGames} WHERE ${userListGames.listId} = ${userLists.id})`;

const listColumns = {
  id: userLists.id,
  userId: userLists.userId,
  name: userLists.name,
  description: userLists.description,
  visibility: userLists.visibility,
  shareToken: userLists.shareToken,
  sortOrder: userLists.sortOrder,
  createdAt: userLists.createdAt,
  updatedAt: userLists.updatedAt,
  gameCount: gameCountExpr,
};

export async function countUserLists(userId: number): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(userLists).where(eq(userLists.userId, userId));
  return row?.n ?? 0;
}

export async function listUserLists(userId: number): Promise<ListRow[]> {
  return getDb().select(listColumns).from(userLists).where(eq(userLists.userId, userId)).orderBy(asc(userLists.sortOrder), asc(userLists.id));
}

export async function findOwnedList(userId: number, listId: number): Promise<ListRow | null> {
  const [row] = await getDb()
    .select(listColumns)
    .from(userLists)
    .where(and(eq(userLists.id, listId), eq(userLists.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function findWithOwner(where: ReturnType<typeof eq>): Promise<ListWithOwner | null> {
  const [row] = await getDb()
    .select({
      ...listColumns,
      ownerName: users.displayName,
      ownerHandle: users.handle,
      ownerAvatar: users.avatarUrl,
      ownerSuspendedAt: users.suspendedAt,
    })
    .from(userLists)
    .innerJoin(users, eq(users.id, userLists.userId))
    .where(where)
    .limit(1);
  if (!row) return null;
  const { ownerName, ownerHandle, ownerAvatar, ownerSuspendedAt, ...list } = row;
  return { ...list, owner: { displayName: ownerName, handle: ownerHandle, avatarUrl: ownerAvatar, suspended: ownerSuspendedAt !== null } };
}

export const findListWithOwner = (listId: number): Promise<ListWithOwner | null> => findWithOwner(eq(userLists.id, listId));
export const findListByShareToken = (token: string): Promise<ListWithOwner | null> => findWithOwner(eq(userLists.shareToken, token));

/** 新增（sortOrder＝目前最大值 + 1，排在最後）。 */
export async function insertList(
  userId: number,
  input: { name: string; description: string | null; visibility: ListVisibility; shareToken: string | null },
): Promise<ListRow> {
  const [created] = await getDb()
    .insert(userLists)
    .values({
      userId,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      shareToken: input.shareToken,
      sortOrder: sql`(SELECT COALESCE(MAX(${userLists.sortOrder}), -1) + 1 FROM ${userLists} WHERE ${userLists.userId} = ${userId})`,
    })
    .returning({ id: userLists.id });
  const row = await findOwnedList(userId, created!.id);
  return row!;
}

export async function updateList(
  userId: number,
  listId: number,
  patch: { name?: string; description?: string | null; visibility?: ListVisibility; shareToken?: string | null },
): Promise<ListRow | null> {
  const res = await getDb()
    .update(userLists)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(userLists.id, listId), eq(userLists.userId, userId)))
    .returning({ id: userLists.id });
  if (res.length === 0) return null;
  return findOwnedList(userId, listId);
}

export async function deleteList(userId: number, listId: number): Promise<boolean> {
  const res = await getDb().delete(userLists).where(and(eq(userLists.id, listId), eq(userLists.userId, userId))).returning({ id: userLists.id });
  return res.length > 0;
}

export interface ListGameRow {
  gameId: number;
  position: number;
  note: string | null;
  addedAt: Date;
}

export async function listGameRows(listId: number, limit: number, offset: number): Promise<{ rows: ListGameRow[]; hasMore: boolean }> {
  const rows = await getDb()
    .select({ gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt })
    .from(userListGames)
    .where(eq(userListGames.listId, listId))
    .orderBy(asc(userListGames.position), asc(userListGames.addedAt), asc(userListGames.gameId))
    .limit(limit + 1)
    .offset(offset);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** 清單內所有遊戲 id，依排序。 */
export async function listGameIds(listId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ gameId: userListGames.gameId })
    .from(userListGames)
    .where(eq(userListGames.listId, listId))
    .orderBy(asc(userListGames.position), asc(userListGames.addedAt), asc(userListGames.gameId));
  return rows.map((r) => r.gameId);
}

export type AddGameResult =
  | { kind: "created"; row: ListGameRow }
  | { kind: "exists"; row: ListGameRow }
  | { kind: "limit_reached" };

/**
 * 加入清單：鎖住清單列（FOR UPDATE）後檢查上限並排在最後。已在清單內＝不重複加入；note 有給（含 null）才更新備註。
 */
export async function addGameToList(listId: number, gameId: number, note: string | null | undefined, maxGames: number): Promise<AddGameResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${userLists} WHERE id = ${listId} FOR UPDATE`);
    const [existing] = await tx
      .select({ gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt })
      .from(userListGames)
      .where(and(eq(userListGames.listId, listId), eq(userListGames.gameId, gameId)))
      .limit(1);
    if (existing) {
      if (note === undefined) return { kind: "exists", row: existing } as const;
      const [upd] = await tx
        .update(userListGames)
        .set({ note })
        .where(and(eq(userListGames.listId, listId), eq(userListGames.gameId, gameId)))
        .returning({ gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt });
      return { kind: "exists", row: upd! } as const;
    }
    const [cnt] = await tx.select({ n: sql<number>`count(*)::int`, max: sql<number>`COALESCE(MAX(${userListGames.position}), -1)` }).from(userListGames).where(eq(userListGames.listId, listId));
    if ((cnt?.n ?? 0) >= maxGames) return { kind: "limit_reached" } as const;
    const [row] = await tx
      .insert(userListGames)
      .values({ listId, gameId, position: (cnt?.max ?? -1) + 1, note: note ?? null })
      .returning({ gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt });
    await tx.update(userLists).set({ updatedAt: new Date() }).where(eq(userLists.id, listId));
    return { kind: "created", row: row! } as const;
  });
}

export async function setListGameNote(listId: number, gameId: number, note: string | null): Promise<ListGameRow | null> {
  const [row] = await getDb()
    .update(userListGames)
    .set({ note })
    .where(and(eq(userListGames.listId, listId), eq(userListGames.gameId, gameId)))
    .returning({ gameId: userListGames.gameId, position: userListGames.position, note: userListGames.note, addedAt: userListGames.addedAt });
  return row ?? null;
}

export async function removeGameFromList(listId: number, gameId: number): Promise<boolean> {
  const res = await getDb()
    .delete(userListGames)
    .where(and(eq(userListGames.listId, listId), eq(userListGames.gameId, gameId)))
    .returning({ gameId: userListGames.gameId });
  if (res.length > 0) await getDb().update(userLists).set({ updatedAt: new Date() }).where(eq(userLists.id, listId));
  return res.length > 0;
}

/** 依給定順序重寫 position（0..n-1）。 */
export async function applyGameOrder(listId: number, orderedGameIds: readonly number[]): Promise<void> {
  if (orderedGameIds.length === 0) return;
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${userLists} WHERE id = ${listId} FOR UPDATE`);
    for (let i = 0; i < orderedGameIds.length; i++) {
      await tx
        .update(userListGames)
        .set({ position: i })
        .where(and(eq(userListGames.listId, listId), eq(userListGames.gameId, orderedGameIds[i]!)));
    }
    await tx.update(userLists).set({ updatedAt: new Date() }).where(eq(userLists.id, listId));
  });
}

export async function userListIds(userId: number): Promise<number[]> {
  const rows = await getDb().select({ id: userLists.id }).from(userLists).where(eq(userLists.userId, userId)).orderBy(asc(userLists.sortOrder), asc(userLists.id));
  return rows.map((r) => r.id);
}

/** 依給定順序重寫該使用者清單的 sortOrder（0..n-1）；只動屬於該使用者的列。 */
export async function applyListOrder(userId: number, orderedListIds: readonly number[]): Promise<void> {
  if (orderedListIds.length === 0) return;
  await getDb().transaction(async (tx) => {
    for (let i = 0; i < orderedListIds.length; i++) {
      await tx
        .update(userLists)
        .set({ sortOrder: i })
        .where(and(eq(userLists.id, orderedListIds[i]!), eq(userLists.userId, userId)));
    }
  });
}

export interface ListMembership {
  id: number;
  name: string;
  visibility: ListVisibility;
  gameCount: number;
  contains: boolean;
  note: string | null;
}

/** 該使用者的所有清單，標出哪些含有這款遊戲（me/games 用）。 */
export async function listsWithGameFlag(userId: number, gameId: number): Promise<ListMembership[]> {
  const rows = await getDb()
    .select({
      id: userLists.id,
      name: userLists.name,
      visibility: userLists.visibility,
      gameCount: gameCountExpr,
      inList: userListGames.gameId,
      note: userListGames.note,
    })
    .from(userLists)
    .leftJoin(userListGames, and(eq(userListGames.listId, userLists.id), eq(userListGames.gameId, gameId)))
    .where(eq(userLists.userId, userId))
    .orderBy(asc(userLists.sortOrder), asc(userLists.id));
  return rows.map((r) => ({ id: r.id, name: r.name, visibility: r.visibility, gameCount: r.gameCount, contains: r.inList !== null, note: r.note }));
}

export async function existingListIdsOf(userId: number, ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await getDb().select({ id: userLists.id }).from(userLists).where(and(eq(userLists.userId, userId), inArray(userLists.id, [...ids])));
  return rows.map((r) => r.id);
}

/** 這位使用者所有清單內的遊戲 id（去重；`mine=collected` 用）。 */
export async function allListedGameIds(userId: number): Promise<number[]> {
  const rows = await getDb()
    .selectDistinct({ gameId: userListGames.gameId })
    .from(userListGames)
    .innerJoin(userLists, eq(userLists.id, userListGames.listId))
    .where(eq(userLists.userId, userId))
    .orderBy(asc(userListGames.gameId));
  return rows.map((r) => r.gameId);
}
