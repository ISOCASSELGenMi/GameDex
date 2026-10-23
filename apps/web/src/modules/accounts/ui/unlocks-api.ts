/**
 * 客戶端呼叫 /api/v1/me/unlocks（Z3B）。push 失敗（離線、停權、限流）時退回傳入的本機清單，不丟例外：
 * 彩蛋端照常只存瀏覽器，下一次 push 再合併（伺服器端冪等）。
 */
import type { UnlockRecord, UnlockSync } from "@/kernel/ui/unlocks";
import { apiCall, jsonBody } from "./api-call";

const URL_UNLOCKS = "/api/v1/me/unlocks";

export const getUnlocks = () => apiCall<{ unlocks: UnlockRecord[] }>(URL_UNLOCKS);
export const postUnlocks = (unlocks: readonly UnlockRecord[]) => apiCall<{ unlocks: UnlockRecord[] }>(URL_UNLOCKS, jsonBody("POST", { unlocks }));

/** 伺服器一次最多收的筆數（與 domain UNLOCK_POST_MAX 相同；客戶端分批送）。 */
const BATCH = 100;

export const accountUnlockSync: UnlockSync = {
  async push(local) {
    let merged: UnlockRecord[] | null = null;
    const batches: UnlockRecord[][] = [];
    for (let i = 0; i < Math.max(local.length, 1); i += BATCH) batches.push(local.slice(i, i + BATCH));
    for (const batch of batches) {
      const res = await postUnlocks(batch);
      if (!res.ok || !res.data || !Array.isArray(res.data.unlocks)) return [...local];
      merged = res.data.unlocks;
    }
    return merged ?? [...local];
  },
};
