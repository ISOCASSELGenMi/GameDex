// 「我的遊戲」篩選擴充點（02 §擴充點、06 §篩選「我的遊戲」）。零外部依賴。

/** mine 篩選的值：followed｜owned｜collected｜list:<id>。 */
export const MINE_FILTER_KEYWORDS = ["followed", "owned", "collected"] as const;
export type MineKeyword = (typeof MINE_FILTER_KEYWORDS)[number];

/**
 * 可選模組（accounts）實作、經 manifest 的 `gameFilters` 提供給 catalog；catalog 不 import 提供者。
 * 提供者只負責回答「這個使用者的 X 是哪些遊戲」；篩選與聚合仍由 catalog 的讀取 Use Case 做。
 */
export interface GameFilterProvider {
  /** 篩選維度（FilterSpec 的欄位）；目前只有 "mine"。 */
  readonly dimension: "mine";
  /** 這個值（例 "followed"、"list:12"）是不是由我處理。 */
  handles(value: string): boolean;
  /**
   * 該使用者符合條件的遊戲 id（去重）。null＝值本身無效或不可存取（例如別人的清單、不存在的清單）。
   * 不檢查遊戲是否仍存在於 catalog（交給之後的 catalog 查詢自然過濾）。
   */
  resolve(userId: number, value: string): Promise<number[] | null>;
}

/** `list:<id>` → id；格式不對 null。 */
export function parseMineListValue(value: string): number | null {
  const m = /^list:(\d{1,10})$/.exec(value);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
