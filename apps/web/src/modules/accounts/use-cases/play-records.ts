/**
 * 遊玩紀錄與玩家平均 Use Case（09 §遊玩紀錄）。所有紀錄只回給本人；對外（非本人）的轉換一律經 toPublicPlayRecord（不含 privateNote）。
 */
import {
  gameExists,
  gameHasPlatform,
  getGameCardsByIds,
  getGamePlatformOptions,
  type GameMiniCard,
  type GamePlatformOption,
} from "@/modules/catalog";
import type { FieldErrors } from "../domain/entities/lists";
import {
  PLAY_RECORDS_MAX_PER_USER,
  PLAY_RECORDS_PAGE_DEFAULT,
  PLAY_RECORDS_PAGE_MAX,
  averageHalfStepsToScore,
  datesOrdered,
  halfStepsToScore,
  type PlayRecordCreateInput,
  type PlayRecordFields,
  type PlayRecordView,
  type PlayStatsView,
} from "../domain/entities/play-records";
import { resolvePlayerRatingMinCount, type PlayerRatingView } from "../domain/entities/player-rating";
import { listsWithGameFlag, type ListMembership } from "../repository/lists";
import {
  countPlayRecords,
  deletePlayRecord,
  findPlayRecord,
  findPlayerRating,
  insertPlayRecord,
  listPlayRecords,
  playStatsForUser,
  refreshPlayerRatings,
  updatePlayRecord,
  type PlayRecordRow,
  type PlayRecordWrite,
} from "../repository/play-records";
import { findUserSettings } from "../repository/user-settings";

export function toPlayRecordView(r: PlayRecordRow): PlayRecordView {
  return {
    id: r.id,
    gameId: r.gameId,
    platformId: r.platformId,
    status: r.status,
    startedOn: r.startedOn,
    finishedOn: r.finishedOn,
    playMinutes: r.playMinutes,
    ratingHalfSteps: r.ratingHalfSteps,
    rating: halfStepsToScore(r.ratingHalfSteps),
    review: r.review,
    reviewHasSpoilers: r.reviewHasSpoilers,
    reviewVisibility: r.reviewVisibility,
    privateNote: r.privateNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type PlayRecordFailure =
  | { ok: false; code: "game_not_found" | "record_not_found" | "play_record_limit_reached" | "unauthorized" }
  | { ok: false; code: "validation_failed"; fields: FieldErrors };

export async function createPlayRecord(userId: number, input: PlayRecordCreateInput): Promise<{ ok: true; record: PlayRecordView } | PlayRecordFailure> {
  const settings = await findUserSettings(userId);
  if (!settings) return { ok: false, code: "unauthorized" };
  if (!(await gameExists(input.gameId))) return { ok: false, code: "game_not_found" };
  if (input.platformId !== null && !(await gameHasPlatform(input.gameId, input.platformId))) {
    return { ok: false, code: "validation_failed", fields: { platformId: "not_in_game" } };
  }
  if ((await countPlayRecords(userId)) >= PLAY_RECORDS_MAX_PER_USER) return { ok: false, code: "play_record_limit_reached" };
  const { reviewVisibility, ...rest } = input;
  const write: PlayRecordWrite = { ...rest, reviewVisibility: reviewVisibility ?? settings.defaultReviewVisibility };
  return { ok: true, record: toPlayRecordView(await insertPlayRecord(userId, write)) };
}

export async function patchPlayRecord(
  userId: number,
  id: number,
  patch: Partial<PlayRecordFields>,
): Promise<{ ok: true; record: PlayRecordView } | PlayRecordFailure> {
  const current = await findPlayRecord(userId, id);
  if (!current) return { ok: false, code: "record_not_found" };
  const startedOn = patch.startedOn !== undefined ? patch.startedOn : current.startedOn;
  const finishedOn = patch.finishedOn !== undefined ? patch.finishedOn : current.finishedOn;
  if (!datesOrdered(startedOn, finishedOn)) return { ok: false, code: "validation_failed", fields: { finishedOn: "before_started_on" } };
  if (patch.platformId !== undefined && patch.platformId !== null && !(await gameHasPlatform(current.gameId, patch.platformId))) {
    return { ok: false, code: "validation_failed", fields: { platformId: "not_in_game" } };
  }
  const { reviewVisibility, ...rest } = patch;
  const write: Partial<PlayRecordWrite> = { ...rest, ...(reviewVisibility !== undefined ? { reviewVisibility } : {}) };
  const row = await updatePlayRecord(userId, id, write);
  if (!row) return { ok: false, code: "record_not_found" };
  return { ok: true, record: toPlayRecordView(row) };
}

export const removePlayRecord = (userId: number, id: number): Promise<boolean> => deletePlayRecord(userId, id);

export interface PlayRecordListItem extends PlayRecordView {
  game: GameMiniCard | null;
}

export async function getMyPlayRecords(
  userId: number,
  opts: { gameId?: number; limit?: number; offset?: number; locale: string | null },
): Promise<{ items: PlayRecordListItem[]; hasMore: boolean; limit: number; offset: number }> {
  const limit = Math.min(PLAY_RECORDS_PAGE_MAX, Math.max(1, opts.limit ?? PLAY_RECORDS_PAGE_DEFAULT));
  const offset = Math.max(0, opts.offset ?? 0);
  const { rows, hasMore } = await listPlayRecords(userId, { gameId: opts.gameId, limit, offset });
  const cards = await getGameCardsByIds(rows.map((r) => r.gameId), opts.locale);
  return { items: rows.map((r) => ({ ...toPlayRecordView(r), game: cards.get(r.gameId) ?? null })), hasMore, limit, offset };
}

export const getMyPlayStats = (userId: number, now: Date = new Date()): Promise<PlayStatsView> => playStatsForUser(userId, now.getUTCFullYear());

export interface MyGameState {
  gameId: number;
  /** 我所有清單（含沒有這款遊戲的），contains 標出哪些有；加入清單選單用。 */
  lists: ListMembership[];
  playRecords: PlayRecordView[];
  /** 該遊戲的平台選項（記錄遊玩的平台下拉）。 */
  platforms: GamePlatformOption[];
}

export async function getMyGameState(userId: number, gameId: number): Promise<MyGameState | null> {
  if (!(await gameExists(gameId))) return null;
  const [lists, records, platforms] = await Promise.all([
    listsWithGameFlag(userId, gameId),
    listPlayRecords(userId, { gameId, limit: PLAY_RECORDS_PAGE_MAX, offset: 0 }),
    getGamePlatformOptions(gameId),
  ]);
  return { gameId, lists, playRecords: records.rows.map(toPlayRecordView), platforms };
}

/** 玩家平均（公開）。遊戲不存在回 null。人數不到 PLAYER_RATING_MIN_COUNT（預設 5）時 avg 為 null。 */
export async function getPlayerRating(gameId: number, minCount: number = resolvePlayerRatingMinCount(process.env.PLAYER_RATING_MIN_COUNT)): Promise<PlayerRatingView | null> {
  if (!(await gameExists(gameId))) return null;
  const row = await findPlayerRating(gameId);
  if (!row) return { ratingCount: 0, avg: null, avgPlayMinutes: null };
  return {
    ratingCount: row.ratingCount,
    avg: row.avgHalfSteps !== null && row.ratingCount >= minCount ? averageHalfStepsToScore(row.avgHalfSteps) : null,
    avgPlayMinutes: row.avgPlayMinutes,
  };
}

/** 排程 refresh_player_ratings。 */
export const runRefreshPlayerRatings = refreshPlayerRatings;
