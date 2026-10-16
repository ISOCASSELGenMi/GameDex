/** 客戶端呼叫追蹤、我的遊戲、私人行事曆 API（第 6 波；契約見 07 與 R 報告）。型別沿用 catalog 的 read model 與 accounts Domain。 */
import type { FollowTargetView, MyGamesPage } from "@/modules/catalog";
import type { CalendarFeedView, FeedPatchInput } from "../domain/entities/calendar-feeds";
import type { FollowTarget } from "../domain/entities/follows";
import { apiCall, jsonBody } from "./api-call";

const loc = (locale: string) => `locale=${encodeURIComponent(locale)}`;

// ── 追蹤 ──────────────────────────────────────────────────────────────
export interface FollowStateItem {
  targetType: FollowTarget;
  targetId: number;
  following: boolean;
  count?: number | null;
}
export const getFollowState = (targets: readonly { targetType: FollowTarget; targetId: number }[]) =>
  apiCall<{ items: FollowStateItem[] }>(`/api/v1/me/follows/state?targets=${targets.map((t) => `${t.targetType}:${t.targetId}`).join(",")}`);
export const followTarget = (targetType: FollowTarget, targetId: number) =>
  apiCall<{ following: true; created: boolean }>(`/api/v1/follows/${targetType}/${targetId}`, jsonBody("PUT"));
export const unfollowTarget = (targetType: FollowTarget, targetId: number) =>
  apiCall<{ following: false; removed: boolean }>(`/api/v1/follows/${targetType}/${targetId}`, jsonBody("DELETE"));

export interface FollowListItem {
  targetType: FollowTarget;
  targetId: number;
  followedAt: string;
  /** null＝目標已不存在（孤兒，等每晚清理）。 */
  target: FollowTargetView | null;
}
export interface FollowListResponse {
  items: FollowListItem[];
  hasMore: boolean;
  limit: number;
  offset: number;
}
export const listFollows = (targetType: FollowTarget, locale: string, offset = 0, limit = 50) =>
  apiCall<FollowListResponse>(`/api/v1/follows?targetType=${targetType}&${loc(locale)}&limit=${limit}&offset=${offset}`);

// ── 我的遊戲 ───────────────────────────────────────────────────────────
export interface MyGamesQuery {
  /** `followed`、`owned`、`collected`、`list:<id>`（可多個，聯集）。 */
  mine: readonly string[];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
export const getMyGames = (q: MyGamesQuery, locale: string) => {
  const p = new URLSearchParams({ mine: q.mine.join(","), locale });
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.limit) p.set("limit", String(q.limit));
  if (q.offset) p.set("offset", String(q.offset));
  return apiCall<MyGamesPage & { mine: string[] }>(`/api/v1/me/games?${p.toString()}`);
};

// ── 私人行事曆 ─────────────────────────────────────────────────────────
export const getCalendarFeed = () => apiCall<{ feed: CalendarFeedView; created: boolean }>("/api/v1/calendar/feeds");
export const patchCalendarFeed = (id: number, body: FeedPatchInput) => apiCall<{ feed: CalendarFeedView; changed: boolean }>(`/api/v1/calendar/feeds/${id}`, jsonBody("PATCH", body));
export const rotateCalendarFeed = (id: number) => apiCall<{ feed: CalendarFeedView }>(`/api/v1/calendar/feeds/${id}/rotate`, jsonBody("POST"));
