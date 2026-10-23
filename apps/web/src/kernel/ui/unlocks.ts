/**
 * 彩蛋解鎖紀錄的共用合約（docs/design/easter-eggs.md；GameDex 第二輪 Z3）。
 * - 瀏覽器端（catalog／kernel 的背景與彩蛋）產生紀錄、存在 localStorage；登入時由 accounts 註冊的同步器合併進帳號（取聯集）。
 * - kernel 不 import 任何模組：accounts 在 client 端呼叫 registerUnlockSync() 掛上同步器，彩蛋端只呼叫 unlock()／getUnlockSync()。
 * - 新增 key 只能加在下面的陣列（同一份清單給兩邊用）；資料庫只存 type＋key＋時間，不存顯示文字。
 */

export const UNLOCK_THEME_KEYS = [
  "sony-blue", // 1a △○×□
  "xbox-green", // 1b ABXY
  "nintendo-red", // 1c 十字鍵
  "eight-bit", // 2 科納米密技
  "gold", // 3 集滿 8 種媒體
  "standby-purple", // 4 閒置 60 秒
  "arcade-neon", // 5 波動拳
  "night-owl", // 6 凌晨 2～4 點
  "coding", // 8 連點品牌 10 次
] as const;
export type UnlockThemeKey = (typeof UNLOCK_THEME_KEYS)[number];

export const UNLOCK_COLLECTIBLE_KEYS = ["cartridge", "floppy", "cd", "dvd", "bluray", "memory-card", "game-card", "cloud"] as const;
export type UnlockCollectibleKey = (typeof UNLOCK_COLLECTIBLE_KEYS)[number];

export const UNLOCK_ACHIEVEMENT_KEYS = [
  "viewed-50-games", // 瀏覽器端計數
  "first-ical-subscribe", // 瀏覽器端（訂閱頁按鈕）；登入時帳號資料為準
  "first-follow", // 帳號資料
  "first-list", // 帳號資料
  "all-achievements", // 其餘全部達成
] as const;
export type UnlockAchievementKey = (typeof UNLOCK_ACHIEVEMENT_KEYS)[number];

export const UNLOCK_TYPES = ["theme", "collectible", "achievement"] as const;
export type UnlockType = (typeof UNLOCK_TYPES)[number];

export interface UnlockRecord {
  type: UnlockType;
  key: string;
  /** ISO 8601（UTC）。合併時同一 type＋key 取較早的時間。 */
  at: string;
}

const KEYS: Record<UnlockType, readonly string[]> = {
  theme: UNLOCK_THEME_KEYS,
  collectible: UNLOCK_COLLECTIBLE_KEYS,
  achievement: UNLOCK_ACHIEVEMENT_KEYS,
};

/** 驗證一筆紀錄（API 與 localStorage 讀取都用這個；不認得的丟掉）。 */
export function isValidUnlock(value: unknown): value is UnlockRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.type !== "string" || !(UNLOCK_TYPES as readonly string[]).includes(r.type)) return false;
  if (typeof r.key !== "string" || !KEYS[r.type as UnlockType].includes(r.key)) return false;
  return typeof r.at === "string" && !Number.isNaN(Date.parse(r.at));
}

/** 聯集合併：同一 type＋key 留較早的 at；結果依 type、key 排序（穩定、可比較）。 */
export function mergeUnlocks(...lists: readonly (readonly UnlockRecord[])[]): UnlockRecord[] {
  const byId = new Map<string, UnlockRecord>();
  for (const list of lists) {
    for (const r of list) {
      if (!isValidUnlock(r)) continue;
      const id = `${r.type}:${r.key}`;
      const prev = byId.get(id);
      if (!prev || Date.parse(r.at) < Date.parse(prev.at)) byId.set(id, { type: r.type, key: r.key, at: new Date(r.at).toISOString() });
    }
  }
  return [...byId.values()].sort((a, b) => (a.type === b.type ? a.key.localeCompare(b.key) : a.type.localeCompare(b.type)));
}

/** 登入後由 accounts 掛上；未登入時為 null，彩蛋端只存瀏覽器。 */
export interface UnlockSync {
  /** 把本機紀錄送上去合併，回傳帳號端合併後的完整清單。 */
  push(local: readonly UnlockRecord[]): Promise<UnlockRecord[]>;
}

let sync: UnlockSync | null = null;
const listeners = new Set<(s: UnlockSync | null) => void>();

export function registerUnlockSync(next: UnlockSync | null): void {
  sync = next;
  for (const fn of listeners) fn(sync);
}

export function getUnlockSync(): UnlockSync | null {
  return sync;
}

/** 同步器掛上或移除時通知（彩蛋端用來在登入後立刻合併一次）。回傳取消訂閱函式。 */
export function onUnlockSyncChange(fn: (s: UnlockSync | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
