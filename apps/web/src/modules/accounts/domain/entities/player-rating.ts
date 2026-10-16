/** 玩家平均（05 §玩家平均、D68；09）：顯示門檻與對外格式。純函式。 */

export const PLAYER_RATING_MIN_COUNT_DEFAULT = 5;

/** PLAYER_RATING_MIN_COUNT：正整數；未設或不合法用預設 5。 */
export function resolvePlayerRatingMinCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return PLAYER_RATING_MIN_COUNT_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : PLAYER_RATING_MIN_COUNT_DEFAULT;
}

/** GET /api/v1/player-ratings/{gameId} 的回應。 */
export interface PlayerRatingView {
  /** 計入的人數（一人一票；停權者不計）。 */
  ratingCount: number;
  /** 0.5~10、一位小數；人數 < 門檻時為 null（不顯示）。 */
  avg: number | null;
  /** 站內回報的平均耗時（分鐘）；沒有資料為 null。 */
  avgPlayMinutes: number | null;
}
