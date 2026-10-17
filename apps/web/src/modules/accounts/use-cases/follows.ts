/**
 * 追蹤 Use Case（09 §追蹤、03 §熱度）。目標是否存在、顯示資訊都經 catalog 的公開 API（accounts 不碰 catalog 的表）。
 * 隱私（D48）：追蹤清單只有本人讀得到；公開的只有人數，低於 FOLLOW_COUNT_MIN_DISPLAY 回 null，停權帳號不計。
 */
import { sendAlertWebhook } from "@/kernel/alerts/webhook";
import { getCoreEnv } from "@/kernel/config/env";
import {
  displayFollowerCount,
  filterExistingFollowTargets,
  followTargetExists,
  getFollowTargetViewMap,
  resolveFollowCountMinDisplay,
  type FollowTargetView,
} from "@/modules/catalog";
import {
  FOLLOW_LIST_LIMIT_DEFAULT,
  FOLLOW_LIST_LIMIT_MAX,
  FOLLOW_RATE_WINDOW_MS,
  FOLLOW_TARGETS,
  resolveFollowMaxPerDay,
  type FollowTarget,
  type FollowTargetKey,
} from "../domain/entities/follows";
import {
  countFollowers,
  countFollowsSince,
  deleteFollow,
  deleteFollowsByTarget,
  findFollowed,
  followExists,
  insertFollow,
  listDistinctTargetIds,
  listFollows,
} from "../repository/follows";

const keyOf = (k: FollowTargetKey) => `${k.targetType}:${k.targetId}`;

export type FollowResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "target_not_found" | "follow_limit_reached" };

/**
 * 追蹤（冪等）：目標不存在 → target_not_found；已追蹤 → created:false（不計入每日上限）；
 * 新增時檢查「過去 24 小時（滾動）新增的追蹤數」是否已達 FOLLOW_MAX_PER_DAY → follow_limit_reached。
 * 先數再插：同一人並發請求可能略超過上限（可接受）。
 */
export async function followTarget(userId: number, key: FollowTargetKey, now: Date = new Date()): Promise<FollowResult> {
  if (!(await followTargetExists(key.targetType, key.targetId))) return { ok: false, code: "target_not_found" };
  if (await followExists(userId, key)) return { ok: true, created: false };
  const since = new Date(now.getTime() - FOLLOW_RATE_WINDOW_MS);
  if ((await countFollowsSince(userId, since)) >= resolveFollowMaxPerDay(process.env.FOLLOW_MAX_PER_DAY)) {
    return { ok: false, code: "follow_limit_reached" };
  }
  return { ok: true, created: await insertFollow(userId, key) };
}

/** 取消追蹤（冪等，不檢查目標是否存在——目標被刪後使用者仍可清掉自己的追蹤）。 */
export async function unfollowTarget(userId: number, key: FollowTargetKey): Promise<{ removed: boolean }> {
  return { removed: await deleteFollow(userId, key) };
}

export interface FollowItemView {
  targetType: FollowTarget;
  targetId: number;
  /** ISO 8601。 */
  followedAt: string;
  /** 目標已不存在（孤兒，等每晚清理）時為 null。 */
  target: FollowTargetView | null;
}

export interface FollowListView {
  items: FollowItemView[];
  hasMore: boolean;
  limit: number;
  offset: number;
}

/** 本人的追蹤清單（新到舊），帶目標的顯示資訊。 */
export async function getMyFollows(
  userId: number,
  opts: { targetType?: FollowTarget; limit?: number; offset?: number; locale: string | null },
): Promise<FollowListView> {
  const limit = Math.min(FOLLOW_LIST_LIMIT_MAX, Math.max(1, opts.limit ?? FOLLOW_LIST_LIMIT_DEFAULT));
  const offset = Math.max(0, opts.offset ?? 0);
  const { rows, hasMore } = await listFollows(userId, { targetType: opts.targetType, limit, offset });
  const views = await getFollowTargetViewMap(rows.map((r) => ({ targetType: r.targetType, targetId: r.targetId })), opts.locale);
  return {
    items: rows.map((r) => ({
      targetType: r.targetType,
      targetId: r.targetId,
      followedAt: r.createdAt.toISOString(),
      target: views.get(keyOf(r)) ?? null,
    })),
    hasMore,
    limit,
    offset,
  };
}

export interface FollowStateItem {
  targetType: FollowTarget;
  targetId: number;
  following: boolean;
  /** 只在 withCount 時出現；低於 FOLLOW_COUNT_MIN_DISPLAY 為 null。 */
  count?: number | null;
}

/** 一次查多個目標「我是否追蹤」（詳情頁、卡片按鈕用）。withCount＝順便回公開人數（已套門檻）。 */
export async function getFollowStates(userId: number, keys: readonly FollowTargetKey[], opts: { withCount?: boolean } = {}): Promise<FollowStateItem[]> {
  const following = await findFollowed(userId, keys);
  const counts = opts.withCount ? await countFollowers(keys) : null;
  const min = resolveFollowCountMinDisplay(process.env.FOLLOW_COUNT_MIN_DISPLAY);
  return keys.map((k) => ({
    targetType: k.targetType,
    targetId: k.targetId,
    following: following.has(keyOf(k)),
    ...(counts ? { count: displayFollowerCount(counts.get(keyOf(k)) ?? 0, min) } : {}),
  }));
}

export interface FollowCountView {
  targetType: FollowTarget;
  targetId: number;
  /** 低於 FOLLOW_COUNT_MIN_DISPLAY 為 null（D48）。 */
  count: number | null;
  /** 門檻（UI 不需要，除錯與文件用）。 */
  minDisplay: number;
}

/** 公開追蹤人數。目標不存在 → null。與檢視者無關，可公開快取。 */
export async function getPublicFollowCount(key: FollowTargetKey): Promise<FollowCountView | null> {
  if (!(await followTargetExists(key.targetType, key.targetId))) return null;
  const counts = await countFollowers([key]);
  const minDisplay = resolveFollowCountMinDisplay(process.env.FOLLOW_COUNT_MIN_DISPLAY);
  return { ...key, count: displayFollowerCount(counts.get(keyOf(key)) ?? 0, minDisplay), minDisplay };
}

/** 一次問 catalog 的 id 數量上限（陣列參數大小）。 */
const EXISTS_CHUNK = 5000;
/** 安全閥：某種類被追蹤的目標 ≥ 這麼多、卻「全部」不存在時，視為 catalog 異常（連錯資料庫、整張表被清空…），不刪。 */
export const ORPHAN_SANITY_MIN_TARGETS = 20;

/** 保險觸發時的告警（只含種類與目標數，沒有任何個資）。 */
export function orphanSanityAlertMessage(skipped: readonly { type: FollowTarget; targets: number }[]): string {
  const detail = skipped.map((s) => `${s.type}（${s.targets} 個被追蹤的目標全部查不到）`).join("、");
  return `[SoK] 追蹤孤兒清理的保險觸發，已跳過、沒有刪除任何追蹤：${detail}。請檢查 catalog 資料庫是否連錯或資料表被清空。`;
}

export interface CleanupOrphanFollowsDeps {
  /** 告警通道（預設：kernel/alerts 的 webhook，網址取 ALERT_WEBHOOK_URL）。 */
  alert?: (message: string) => Promise<unknown>;
  /** 告警通道網址；省略＝讀環境設定。沒有網址就只寫 log。 */
  webhookUrl?: string | undefined;
  log?: (message: string) => void;
}

/**
 * 每晚孤兒清理（03）：刪除指向已不存在目標的 follows。accounts 不碰 catalog 的表：
 * 先列出各種類被追蹤的不同 id，再問 catalog 哪些還存在。回傳各種類刪除筆數。
 * 保險：某種類 ≥ ORPHAN_SANITY_MIN_TARGETS 個目標「全部」不存在時不刪，並發告警（D83；訊息不含個資）。
 */
export async function cleanupOrphanFollows(deps: CleanupOrphanFollowsDeps = {}): Promise<Record<FollowTarget, number>> {
  const out = {} as Record<FollowTarget, number>;
  const skipped: { type: FollowTarget; targets: number }[] = [];
  for (const type of FOLLOW_TARGETS) {
    const ids = await listDistinctTargetIds(type);
    const orphans: number[] = [];
    for (let i = 0; i < ids.length; i += EXISTS_CHUNK) {
      const chunk = ids.slice(i, i + EXISTS_CHUNK);
      const existing = await filterExistingFollowTargets(type, chunk);
      for (const id of chunk) if (!existing.has(id)) orphans.push(id);
    }
    if (ids.length >= ORPHAN_SANITY_MIN_TARGETS && orphans.length === ids.length) {
      out[type] = 0; // 全部都不存在：不刪（見 ORPHAN_SANITY_MIN_TARGETS）
      skipped.push({ type, targets: ids.length });
      continue;
    }
    let deleted = 0;
    for (let i = 0; i < orphans.length; i += EXISTS_CHUNK) deleted += await deleteFollowsByTarget(type, orphans.slice(i, i + EXISTS_CHUNK));
    out[type] = deleted;
  }
  if (skipped.length > 0) await alertOrphanSanity(skipped, deps);
  return out;
}

/** 告警失敗不影響清理（sendAlertWebhook 本身不丟例外；自訂通道的例外在這裡吞掉並記 log）。 */
async function alertOrphanSanity(skipped: readonly { type: FollowTarget; targets: number }[], deps: CleanupOrphanFollowsDeps): Promise<void> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  const message = orphanSanityAlertMessage(skipped);
  log(`[accounts] ${message}`);
  const url = "webhookUrl" in deps ? deps.webhookUrl : getCoreEnv().ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await (deps.alert ?? ((m: string) => sendAlertWebhook(url, m)))(message);
  } catch (err) {
    log(`[accounts] 孤兒清理告警送出失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}
