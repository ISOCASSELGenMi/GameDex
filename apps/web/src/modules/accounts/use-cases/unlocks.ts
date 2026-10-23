/**
 * 彩蛋解鎖紀錄的 Use Case（Z3B；docs/design/easter-eggs.md）。key 清單與合併規則的唯一定義在 kernel/ui/unlocks.ts（isValidUnlock、mergeUnlocks）。
 * - 帳號資料判定的成就（first-follow／first-list／first-ical-subscribe）：GET 與匯出時即時補上並「持久化」（ON CONFLICT 取較早時間），
 *   所以日後取消追蹤／刪除清單也不會失去成就；時間取證據中最早的一筆。
 * - all-achievements 由瀏覽器判定並 push；伺服器只在其他成就都已在帳號時才接受。
 */
import { isValidUnlock, mergeUnlocks, type UnlockRecord } from "@/kernel/ui/unlocks";
import { ALL_ACHIEVEMENT_PREREQUISITES, type UnlockView } from "../domain/entities/unlocks";
import { listUnlocks as readUnlocks, readAchievementEvidence, upsertUnlocks } from "../repository/unlocks";

/** 未來時間容忍（時鐘誤差）；超過就當作「現在」。 */
export const UNLOCK_FUTURE_SKEW_MS = 5 * 60 * 1000;

const isAll = (r: UnlockRecord): boolean => r.type === "achievement" && r.key === "all-achievements";

/** 純函式：驗證、去重（較早優先）、把未來時間夾到 now。未知 type／key 與格式錯誤的項目丟棄。 */
export function normalizeIncomingUnlocks(items: readonly unknown[], now: Date): UnlockRecord[] {
  const valid = items.filter(isValidUnlock);
  const limit = now.getTime() + UNLOCK_FUTURE_SKEW_MS;
  return mergeUnlocks(valid).map((r) => (Date.parse(r.at) > limit ? { ...r, at: now.toISOString() } : r));
}

/** 純函式：all-achievements 只有在其餘成就都在 `have`（achievement 的 key 集合）時才保留。 */
export function filterAllAchievements(incoming: readonly UnlockRecord[], have: ReadonlySet<string>): UnlockRecord[] {
  const ok = ALL_ACHIEVEMENT_PREREQUISITES.every((k) => have.has(k));
  return incoming.filter((r) => !isAll(r) || ok);
}

/** 讀出並用合約的規則排序（type、key 字串序；同時丟掉合約已不認得的 key）。 */
const listUnlocks = async (userId: number): Promise<UnlockView[]> => mergeUnlocks(await readUnlocks(userId));

const toRow = (r: UnlockRecord) => ({ type: r.type, key: r.key, at: new Date(r.at) });

/** 把帳號資料可判定的成就寫進 user_unlocks（冪等）。 */
export async function syncAccountDerivedAchievements(userId: number): Promise<void> {
  const e = await readAchievementEvidence(userId);
  const items: Array<{ type: "achievement"; key: string; at: Date }> = [];
  if (e.firstFollowAt) items.push({ type: "achievement", key: "first-follow", at: e.firstFollowAt });
  if (e.firstListAt) items.push({ type: "achievement", key: "first-list", at: e.firstListAt });
  // 私人 iCal feed 建立過＝使用者走過「訂閱私人行事曆」流程（revoked 的列也算；建立時間比 lastAccessedAt 早）
  if (e.firstFeedAt) items.push({ type: "achievement", key: "first-ical-subscribe", at: e.firstFeedAt });
  await upsertUnlocks(userId, items);
}

export async function getMyUnlocks(userId: number): Promise<UnlockView[]> {
  await syncAccountDerivedAchievements(userId);
  return listUnlocks(userId);
}

/** 合併瀏覽器送來的紀錄，回傳合併後完整清單。冪等。 */
export async function pushMyUnlocks(userId: number, incoming: readonly unknown[], now: Date = new Date()): Promise<UnlockView[]> {
  const records = normalizeIncomingUnlocks(incoming, now);
  await syncAccountDerivedAchievements(userId);
  await upsertUnlocks(userId, records.filter((r) => !isAll(r)).map(toRow));
  const all = records.filter(isAll);
  if (all.length > 0) {
    const have = new Set((await listUnlocks(userId)).filter((u) => u.type === "achievement").map((u) => u.key));
    await upsertUnlocks(userId, filterAllAchievements(all, have).map(toRow));
  }
  return listUnlocks(userId);
}
