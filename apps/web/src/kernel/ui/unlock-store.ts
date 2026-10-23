/**
 * 解鎖紀錄的瀏覽器端儲存（localStorage，鍵 UNLOCKS_STORAGE_KEY）＋與帳號同步器的橋接。
 * 合約（紀錄格式、合併規則、同步器註冊）在 kernel/ui/unlocks.ts；這裡只負責「存、讀、通知、送出」。
 * - 讀寫全包 try/catch：私密視窗、容量滿或封鎖時紀錄只活在記憶體（頁面關閉即失）。
 * - 同步：有同步器就把本機整份 push 上去，回來的完整清單合併寫回；失敗留在本機，下次（解鎖、登入、重新載入）再送。
 * - getSnapshot 回傳穩定參考（沒變就同一個陣列），可直接給 useSyncExternalStore。
 */
import {
  getUnlockSync,
  isValidUnlock,
  mergeUnlocks,
  onUnlockSyncChange,
  type UnlockRecord,
  type UnlockSync,
  type UnlockType,
} from "./unlocks";

export const UNLOCKS_STORAGE_KEY = "sok-unlocks";

export interface UnlockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const NO_UNLOCKS: readonly UnlockRecord[] = Object.freeze([]);

/** 解析 localStorage 的字串；壞掉或不認得的紀錄丟掉。 */
export function parseUnlocks(raw: string | null | undefined): UnlockRecord[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? mergeUnlocks(data.filter(isValidUnlock)) : [];
  } catch {
    return [];
  }
}

export function hasUnlock(list: readonly UnlockRecord[], type: UnlockType, key: string): boolean {
  return list.some((r) => r.type === type && r.key === key);
}

function sameList(a: readonly UnlockRecord[], b: readonly UnlockRecord[]): boolean {
  return a.length === b.length && a.every((r, i) => r.type === b[i]!.type && r.key === b[i]!.key && r.at === b[i]!.at);
}

export interface UnlockStoreOptions {
  storage: UnlockStorage | null;
  getSync?: () => UnlockSync | null;
  now?: () => Date;
}

export interface UnlockStore {
  getSnapshot(): readonly UnlockRecord[];
  subscribe(fn: () => void): () => void;
  /** 新增一筆解鎖；已存在回傳 false（不通知、不送出）。 */
  unlock(type: UnlockType, key: string): boolean;
  /** 合併外部清單（登入同步、其他分頁）；不觸發「新解鎖」事件。 */
  merge(records: readonly UnlockRecord[]): void;
  /** 重新從儲存讀（其他分頁改了）。 */
  reload(): void;
  /** 有同步器就送一次（解鎖、登入、重新載入時呼叫）。 */
  syncNow(): Promise<void>;
  /** 只在本機「新解鎖」時呼叫（合併進來的不算）。 */
  onUnlock(fn: (record: UnlockRecord) => void): () => void;
}

export function createUnlockStore(opts: UnlockStoreOptions): UnlockStore {
  const { storage } = opts;
  const now = opts.now ?? (() => new Date());
  let list: readonly UnlockRecord[] | null = null;
  const subs = new Set<() => void>();
  const unlockSubs = new Set<(r: UnlockRecord) => void>();
  let syncing = false;
  let syncAgain = false;

  function load(): readonly UnlockRecord[] {
    if (list) return list;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(UNLOCKS_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    list = parseUnlocks(raw);
    return list;
  }

  function commit(next: readonly UnlockRecord[]): void {
    const prev = load();
    if (sameList(prev, next)) return;
    list = next;
    try {
      storage?.setItem(UNLOCKS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 記憶體裡仍有
    }
    for (const fn of subs) fn();
  }

  const store: UnlockStore = {
    getSnapshot: load,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    unlock(type, key) {
      const candidate: UnlockRecord = { type, key, at: now().toISOString() };
      if (!isValidUnlock(candidate)) return false;
      if (hasUnlock(load(), type, key)) return false;
      commit(mergeUnlocks(load(), [candidate]));
      const rec = load().find((r) => r.type === type && r.key === key)!;
      for (const fn of unlockSubs) fn(rec);
      void store.syncNow();
      return true;
    },
    merge(records) {
      commit(mergeUnlocks(load(), records));
    },
    reload() {
      list = null;
      const fresh = load();
      list = fresh;
      for (const fn of subs) fn();
    },
    async syncNow() {
      const sync = opts.getSync?.() ?? null;
      if (!sync) return;
      if (syncing) {
        syncAgain = true;
        return;
      }
      syncing = true;
      try {
        do {
          syncAgain = false;
          try {
            const merged = await sync.push([...load()]);
            store.merge(merged);
          } catch {
            // 失敗：留在本機，下次再送
          }
        } while (syncAgain);
      } finally {
        syncing = false;
      }
    },
    onUnlock(fn) {
      unlockSubs.add(fn);
      return () => unlockSubs.delete(fn);
    },
  };
  return store;
}

let singleton: UnlockStore | null = null;

function browserStorage(): UnlockStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 瀏覽器端單例（掛上 unlocks.ts 的同步器通知與跨分頁 storage 事件）。只在 client 呼叫。 */
export function getUnlockStore(): UnlockStore {
  if (singleton) return singleton;
  const store = createUnlockStore({ storage: browserStorage(), getSync: getUnlockSync });
  singleton = store;
  if (typeof window !== "undefined") {
    onUnlockSyncChange((s) => {
      if (s) void store.syncNow();
    });
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === UNLOCKS_STORAGE_KEY) store.reload();
    });
  }
  return store;
}
