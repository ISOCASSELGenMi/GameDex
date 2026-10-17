/**
 * 追蹤目標的唯讀 Use Case（Phase 7 第 6 波；accounts 的 follows 用）。封面換算由 Provider 負責。
 */
import { followTargetKey, type FollowTargetRef, type FollowTargetType, type FollowTargetView } from "../domain/entities";
import { resolveImageRef } from "../providers/image-ref";
import { findExistingTargetIds, getFollowTargetViews } from "../repository/follow-targets";

/** 這些 id 之中仍存在（且可追蹤）的目標 id。 */
export function filterExistingFollowTargets(type: FollowTargetType, ids: readonly number[]): Promise<Set<number>> {
  return findExistingTargetIds(type, ids);
}

/** 目標是否存在（單一）。 */
export async function followTargetExists(type: FollowTargetType, id: number): Promise<boolean> {
  return (await findExistingTargetIds(type, [id])).has(id);
}

/** 批次取顯示資訊（key＝`type:id`，用 followTargetKey 產生）；不存在的不在 Map。locale 為 null＝原名。 */
export function getFollowTargetViewMap(refs: readonly FollowTargetRef[], locale: string | null = null): Promise<Map<string, FollowTargetView>> {
  return getFollowTargetViews(refs, locale, resolveImageRef);
}

export { followTargetKey };
