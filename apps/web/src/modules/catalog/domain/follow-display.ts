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

/** 「上升中」：site_follows_7d 在群內（有訊號者之間）前 5%（06 §熱度顯示）。 */
export const RISING_TOP_FRACTION = 0.05;
