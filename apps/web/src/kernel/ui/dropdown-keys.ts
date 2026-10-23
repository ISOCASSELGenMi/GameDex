/**
 * 下拉選單的方向鍵規則（純函式，單元測試用）：在 `count` 個項目間移動焦點。
 * current＝目前焦點項目的索引，-1＝焦點不在任何項目（例如在觸發按鈕上）。
 * ArrowDown／ArrowUp 會繞回；Home／End 跳到頭尾；其他按鍵回 null（不處理）。
 */
export function nextDropdownIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** 同時只開一個下拉：開啟時對 window 廣播自己的 name，其他下拉收到就關閉。 */
export const DROPDOWN_OPEN_EVENT = "sok:dropdown-open";

/** 面板內可用方向鍵移動的項目。 */
export const DROPDOWN_ITEM_SELECTOR = "a[href], button:not([disabled])";
