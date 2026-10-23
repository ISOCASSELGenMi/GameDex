/**
 * 彩蛋解鎖紀錄（docs/design/easter-eggs.md「解鎖紀錄與同步」；GameDex 第二輪 Z3B）：我方型別與常數。純函式、零外部依賴。
 * key 清單與 UnlockRecord 的唯一定義在 kernel/ui/unlocks.ts（domain 不能 import kernel，所以這裡的 UNLOCK_TYPES 是副本；單元測試比對兩邊一致）。
 */
export const UNLOCK_TYPES = ["theme", "collectible", "achievement"] as const;
export type UnlockType = (typeof UNLOCK_TYPES)[number];

/** POST /me/unlocks 一次最多幾筆（主題 9＋收集物 8＋成就 5＝22，留餘裕）。 */
export const UNLOCK_POST_MAX = 100;

/** 帳號資料可判定的成就（GET 時即時補上並持久化）。 */
export const ACCOUNT_DERIVED_ACHIEVEMENTS = ["first-follow", "first-list", "first-ical-subscribe"] as const;
export type AccountDerivedAchievement = (typeof ACCOUNT_DERIVED_ACHIEVEMENTS)[number];

/** `all-achievements` 要求這些成就都已在帳號（伺服器才接受瀏覽器 push 的 all-achievements）。 */
export const ALL_ACHIEVEMENT_PREREQUISITES = ["viewed-50-games", "first-ical-subscribe", "first-follow", "first-list"] as const;

/** 資料庫列／匯出用的視圖（at 為 ISO 字串）。 */
export interface UnlockView {
  type: UnlockType;
  key: string;
  at: string;
}
