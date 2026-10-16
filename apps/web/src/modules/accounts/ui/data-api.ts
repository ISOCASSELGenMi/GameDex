/** 客戶端呼叫清單、遊玩紀錄、玩家平均、me/games（第 5 波；契約見 07）。型別沿用 accounts Domain 與 catalog 的 GameMiniCard。 */
import type { GameMiniCard, GamePlatformOption } from "@/modules/catalog";
import type { ListSummaryView, ListOwnerView, ListVisibility } from "../domain/entities/lists";
import type { PlayRecordView, PlayStatsView, PlayStatus, ReviewVisibility } from "../domain/entities/play-records";
import type { PlayerRatingView } from "../domain/entities/player-rating";
import { apiCall, jsonBody } from "./api-call";

const loc = (locale: string) => `locale=${encodeURIComponent(locale)}`;

// ── 清單 ──────────────────────────────────────────────────────────────
export interface MyListsResponse {
  items: ListSummaryView[];
  limits: { maxLists: number; maxGamesPerList: number };
}
export const getMyLists = () => apiCall<MyListsResponse>("/api/v1/lists");
export const createList = (body: { name: string; description?: string | null; visibility?: ListVisibility }) =>
  apiCall<{ list: ListSummaryView }>("/api/v1/lists", jsonBody("POST", body));
export const patchList = (id: number, body: { name?: string; description?: string | null; visibility?: ListVisibility; rotateShareToken?: true }) =>
  apiCall<{ list: ListSummaryView }>(`/api/v1/lists/${id}`, jsonBody("PATCH", body));
export const deleteList = (id: number) => apiCall<{ ok: true }>(`/api/v1/lists/${id}`, jsonBody("DELETE"));
export const reorderLists = (listIds: number[]) => apiCall<{ items: ListSummaryView[] }>("/api/v1/lists/order", jsonBody("PATCH", { listIds }));

export interface ListGameEntryView {
  gameId: number;
  position: number;
  note: string | null;
  addedAt: string;
  game: GameMiniCard | null;
}
export interface ListDetailResponse {
  list: ListSummaryView;
  owner: ListOwnerView;
  isOwner: boolean;
  games: ListGameEntryView[];
  hasMore: boolean;
  limit: number;
  offset: number;
}
export const getList = (id: number, locale: string, offset = 0, limit = 100) =>
  apiCall<ListDetailResponse>(`/api/v1/lists/${id}?${loc(locale)}&limit=${limit}&offset=${offset}`);
export const getSharedList = (token: string, locale: string, limit = 1) =>
  apiCall<ListDetailResponse>(`/api/v1/lists/shared/${encodeURIComponent(token)}?${loc(locale)}&limit=${limit}`);
export const addGameToList = (listId: number, gameId: number) => apiCall<{ created: boolean }>(`/api/v1/lists/${listId}/games/${gameId}`, jsonBody("POST"));
export const removeGameFromList = (listId: number, gameId: number) => apiCall<{ ok: true; removed: boolean }>(`/api/v1/lists/${listId}/games/${gameId}`, jsonBody("DELETE"));
export const setListGameNote = (listId: number, gameId: number, note: string | null) =>
  apiCall<{ entry: { note: string | null } }>(`/api/v1/lists/${listId}/games/${gameId}`, jsonBody("PATCH", { note }));
export const reorderListGames = (listId: number, gameIds: number[]) => apiCall<{ ok: true }>(`/api/v1/lists/${listId}/order`, jsonBody("PATCH", { gameIds }));

// ── 遊玩紀錄 ───────────────────────────────────────────────────────────
export interface PlayRecordInput {
  status: PlayStatus;
  platformId: number | null;
  startedOn: string | null;
  finishedOn: string | null;
  playMinutes: number | null;
  ratingHalfSteps: number | null;
  review: string | null;
  reviewHasSpoilers: boolean;
  /** 省略＝建立時用帳號的預設設定。 */
  reviewVisibility?: ReviewVisibility;
  privateNote: string | null;
}
export type PlayRecordWithGame = PlayRecordView & { game: GameMiniCard | null };
export const getPlayRecords = (locale: string, offset = 0, limit = 50) =>
  apiCall<{ items: PlayRecordWithGame[]; hasMore: boolean }>(`/api/v1/play-records?${loc(locale)}&limit=${limit}&offset=${offset}`);
export const createPlayRecord = (gameId: number, body: PlayRecordInput) =>
  apiCall<{ record: PlayRecordView }>("/api/v1/play-records", jsonBody("POST", { gameId, ...body }));
export const patchPlayRecord = (id: number, body: PlayRecordInput) => apiCall<{ record: PlayRecordView }>(`/api/v1/play-records/${id}`, jsonBody("PATCH", body));
export const deletePlayRecord = (id: number) => apiCall<{ ok: true }>(`/api/v1/play-records/${id}`, jsonBody("DELETE"));
export const getPlayStats = () => apiCall<PlayStatsView>("/api/v1/play-records/stats");

// ── 詳情頁 ─────────────────────────────────────────────────────────────
export interface MyGameState {
  gameId: number;
  lists: { id: number; name: string; visibility: ListVisibility; gameCount: number; contains: boolean; note: string | null }[];
  playRecords: PlayRecordView[];
  platforms: GamePlatformOption[];
}
export const getMyGameState = (gameId: number) => apiCall<MyGameState>(`/api/v1/me/games/${gameId}`);
export const getPlayerRating = (gameId: number) => apiCall<PlayerRatingView>(`/api/v1/player-ratings/${gameId}`, { cache: "default" });
