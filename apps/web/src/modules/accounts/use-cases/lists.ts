/**
 * 收藏清單 Use Case（09 §收藏清單）。
 * 可見度：本人看全部；他人只能讀 public；unlisted 只能用 shareToken；private 對他人一律「不存在」。
 * 停權帳號（users.suspendedAt）：本人仍可讀寫；他人看不到其 public／unlisted 清單。
 * shareToken：切到 unlisted 時產生（沒有才產生）；切離 unlisted 時清空（舊連結立即失效，再切回來是新連結）；rotateShareToken 可手動換新。
 */
import { randomBytes } from "node:crypto";
import { gameExists, getGameCardsByIds, type GameMiniCard } from "@/modules/catalog";
import {
  LIST_GAMES_MAX,
  LIST_GAMES_PAGE_DEFAULT,
  LIST_GAMES_PAGE_MAX,
  LIST_MAX_PER_USER,
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_PATTERN,
  mergeOrder,
  type ListCreateInput,
  type ListOwnerView,
  type ListPatchInput,
  type ListSummaryView,
} from "../domain/entities/lists";
import {
  addGameToList,
  applyGameOrder,
  applyListOrder,
  countUserLists,
  deleteList,
  findListByShareToken,
  findListWithOwner,
  findOwnedList,
  insertList,
  listGameIds,
  listGameRows,
  listUserLists,
  removeGameFromList,
  setListGameNote,
  updateList,
  userListIds,
  type ListRow,
  type ListWithOwner,
} from "../repository/lists";
import { findUserSettings } from "../repository/user-settings";

export const newShareToken = (): string => randomBytes(SHARE_TOKEN_BYTES).toString("base64url");

export function toListSummary(row: ListRow, opts: { isOwner: boolean }): ListSummaryView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    shareToken: opts.isOwner && row.visibility === "unlisted" ? row.shareToken : null,
    sortOrder: row.sortOrder,
    gameCount: row.gameCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getMyLists(userId: number): Promise<ListSummaryView[]> {
  return (await listUserLists(userId)).map((r) => toListSummary(r, { isOwner: true }));
}

export type CreateListResult = { ok: true; list: ListSummaryView } | { ok: false; code: "list_limit_reached" | "unauthorized" };

export async function createList(userId: number, input: ListCreateInput): Promise<CreateListResult> {
  const settings = await findUserSettings(userId);
  if (!settings) return { ok: false, code: "unauthorized" };
  if ((await countUserLists(userId)) >= LIST_MAX_PER_USER) return { ok: false, code: "list_limit_reached" };
  const visibility = input.visibility ?? settings.defaultListVisibility;
  const row = await insertList(userId, {
    name: input.name,
    description: input.description,
    visibility,
    shareToken: visibility === "unlisted" ? newShareToken() : null,
  });
  return { ok: true, list: toListSummary(row, { isOwner: true }) };
}

export async function patchList(userId: number, listId: number, patch: ListPatchInput): Promise<ListSummaryView | null> {
  const current = await findOwnedList(userId, listId);
  if (!current) return null;
  const visibility = patch.visibility ?? current.visibility;
  let shareToken: string | null | undefined;
  if (visibility === "unlisted") {
    if (current.shareToken === null || patch.rotateShareToken === true) shareToken = newShareToken();
  } else if (current.shareToken !== null) {
    shareToken = null;
  }
  const row = await updateList(userId, listId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(shareToken !== undefined ? { shareToken } : {}),
  });
  return row ? toListSummary(row, { isOwner: true }) : null;
}

export const removeList = (userId: number, listId: number): Promise<boolean> => deleteList(userId, listId);

export interface ListGameItem {
  gameId: number;
  position: number;
  note: string | null;
  addedAt: string;
  /** 遊戲被刪或查不到時為 null（理論上有 FK cascade，不會發生）。 */
  game: GameMiniCard | null;
}

export interface ListDetailView {
  list: ListSummaryView;
  owner: ListOwnerView;
  isOwner: boolean;
  games: ListGameItem[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

/**
 * 讀清單。viewerId＝目前登入者（匿名 null）。看不到（不存在、private 且非本人、停權者的公開清單）一律回 null。
 * viaToken＝用 shareToken 讀（只有 unlisted 成立）。
 */
export async function readList(input: {
  listId?: number;
  shareToken?: string;
  viewerId: number | null;
  locale: string | null;
  limit?: number;
  offset?: number;
}): Promise<ListDetailView | null> {
  let row: ListWithOwner | null;
  if (input.shareToken !== undefined) {
    if (!SHARE_TOKEN_PATTERN.test(input.shareToken)) return null;
    row = await findListByShareToken(input.shareToken);
    if (row && row.visibility !== "unlisted") return null;
  } else {
    row = await findListWithOwner(input.listId ?? 0);
  }
  if (!row) return null;
  const isOwner = input.viewerId !== null && input.viewerId === row.userId;
  if (!isOwner) {
    if (row.owner.suspended) return null;
    const viaToken = input.shareToken !== undefined;
    const allowed = row.visibility === "public" || (viaToken && row.visibility === "unlisted");
    if (!allowed) return null;
  }
  const limit = Math.min(LIST_GAMES_PAGE_MAX, Math.max(1, input.limit ?? LIST_GAMES_PAGE_DEFAULT));
  const offset = Math.max(0, input.offset ?? 0);
  const { rows, hasMore } = await listGameRows(row.id, limit, offset);
  const cards = await getGameCardsByIds(rows.map((r) => r.gameId), input.locale);
  const { owner, ...list } = row;
  return {
    list: toListSummary(list, { isOwner }),
    owner: { displayName: owner.displayName, handle: owner.handle, avatarUrl: owner.avatarUrl },
    isOwner,
    games: rows.map((r) => ({ gameId: r.gameId, position: r.position, note: r.note, addedAt: r.addedAt.toISOString(), game: cards.get(r.gameId) ?? null })),
    hasMore,
    limit,
    offset,
  };
}

export interface ListGameEntry {
  listId: number;
  gameId: number;
  position: number;
  note: string | null;
  addedAt: string;
}

export type AddGameOutcome =
  | { ok: true; created: boolean; entry: ListGameEntry }
  | { ok: false; code: "list_not_found" | "game_not_found" | "list_games_limit_reached" };

export async function addToList(userId: number, listId: number, gameId: number, note: string | null | undefined): Promise<AddGameOutcome> {
  const list = await findOwnedList(userId, listId);
  if (!list) return { ok: false, code: "list_not_found" };
  if (!(await gameExists(gameId))) return { ok: false, code: "game_not_found" };
  const res = await addGameToList(listId, gameId, note, LIST_GAMES_MAX);
  if (res.kind === "limit_reached") return { ok: false, code: "list_games_limit_reached" };
  const { row } = res;
  return { ok: true, created: res.kind === "created", entry: { listId, gameId, position: row.position, note: row.note, addedAt: row.addedAt.toISOString() } };
}

export type NoteOutcome = { ok: true; entry: ListGameEntry } | { ok: false; code: "list_not_found" | "not_in_list" };

export async function updateListGameNote(userId: number, listId: number, gameId: number, note: string | null): Promise<NoteOutcome> {
  if (!(await findOwnedList(userId, listId))) return { ok: false, code: "list_not_found" };
  const row = await setListGameNote(listId, gameId, note);
  if (!row) return { ok: false, code: "not_in_list" };
  return { ok: true, entry: { listId, gameId, position: row.position, note: row.note, addedAt: row.addedAt.toISOString() } };
}

export async function removeFromList(userId: number, listId: number, gameId: number): Promise<{ ok: true; removed: boolean } | { ok: false; code: "list_not_found" }> {
  if (!(await findOwnedList(userId, listId))) return { ok: false, code: "list_not_found" };
  return { ok: true, removed: await removeGameFromList(listId, gameId) };
}

export type OrderOutcome = { ok: true } | { ok: false; code: "list_not_found" | "order_mismatch" };

/** 清單內排序：給定的 gameIds 排最前面，其餘維持原順序接在後面；有不在清單內的 id → order_mismatch。 */
export async function reorderListGames(userId: number, listId: number, gameIds: readonly number[]): Promise<OrderOutcome> {
  if (!(await findOwnedList(userId, listId))) return { ok: false, code: "list_not_found" };
  const current = await listGameIds(listId);
  const set = new Set(current);
  if (!gameIds.every((id) => set.has(id))) return { ok: false, code: "order_mismatch" };
  await applyGameOrder(listId, mergeOrder(current, gameIds));
  return { ok: true };
}

/** 清單之間排序（同上語意）。 */
export async function reorderLists(userId: number, listIds: readonly number[]): Promise<OrderOutcome> {
  const current = await userListIds(userId);
  const set = new Set(current);
  if (!listIds.every((id) => set.has(id))) return { ok: false, code: "order_mismatch" };
  await applyListOrder(userId, mergeOrder(current, listIds));
  return { ok: true };
}
