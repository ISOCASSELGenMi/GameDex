/**
 * 追蹤人數的顯示規則（03 §熱度「隱私」、06 §熱度顯示、D48）：低於 FOLLOW_COUNT_MIN_DISPLAY 不顯示數字。
 * 唯一實作；catalog（詳情的 followerCount）與 accounts（公開人數 API）共用。
 */
export const FOLLOW_COUNT_MIN_DISPLAY_DEFAULT = 10;

/** FOLLOW_COUNT_MIN_DISPLAY：正整數；未設或不合法用預設 10。 */
export function resolveFollowCountMinDisplay(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return FOLLOW_COUNT_MIN_DISPLAY_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : FOLLOW_COUNT_MIN_DISPLAY_DEFAULT;
}

/** 人數不到門檻回 null。 */
export function displayFollowerCount(count: number, minDisplay: number): number | null {
  return count >= minDisplay ? count : null;
}

/** 「上升中」：site_follows_7d 在群內（有訊號者之間）前 5%（06 §熱度顯示），而且 7 天新增追蹤數要達門檻（D83）。 */
export const RISING_TOP_FRACTION = 0.05;

/** 「上升中」的最低 7 天新增追蹤數；預設與 FOLLOW_COUNT_MIN_DISPLAY 的預設相同（10）。小樣本（群內只有幾款有訊號）不會因為「必有第一名」而顯示。 */
export const FOLLOW_RISING_MIN_7D_DEFAULT = FOLLOW_COUNT_MIN_DISPLAY_DEFAULT;

/** FOLLOW_RISING_MIN_7D：正整數；未設或不合法用預設 10。 */
export function resolveFollowRisingMin7d(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return FOLLOW_RISING_MIN_7D_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : FOLLOW_RISING_MIN_7D_DEFAULT;
}

/** 「上升中」判斷（唯一實作）：7 天新增 ≥ 門檻，且 percent rank（0＝群內第一）< 5%；沒有排名（不在群內或沒有訊號）為 false。 */
export function isRising(followers7d: number, percentRank: number | null, minNew7d: number): boolean {
  return percentRank !== null && followers7d >= minNew7d && percentRank < RISING_TOP_FRACTION;
}
