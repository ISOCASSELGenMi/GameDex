// 追蹤目標（Phase 7 第 6 波；03 §follows、09 §追蹤）。accounts 的 follows 以 (targetType, targetId) 多型參照 catalog 的表。零外部依賴。
import type { IsoDate } from "./enums";
import type { ImageRef } from "./image-ref";

/** 可追蹤的目標種類（accounts 的 follow_target enum 與此一致；單元測試比對）。 */
export const FOLLOW_TARGET_TYPES = ["game", "event", "platform", "franchise", "company"] as const;
export type FollowTargetType = (typeof FOLLOW_TARGET_TYPES)[number];

export function isFollowTargetType(value: unknown): value is FollowTargetType {
  return typeof value === "string" && (FOLLOW_TARGET_TYPES as readonly string[]).includes(value);
}

export interface FollowTargetRef {
  targetType: FollowTargetType;
  targetId: number;
}

/** 追蹤清單與詳情顯示用的目標資訊（不同種類共用一個扁平形狀，不適用的欄位為 null）。 */
export interface FollowTargetView {
  targetType: FollowTargetType;
  targetId: number;
  slug: string;
  /** 依 locale 的顯示名稱（只有遊戲有 displayNames；其他為原名）。 */
  name: string;
  originalName: string;
  /** 只有遊戲有封面。 */
  cover: ImageRef | null;
  /** game：首發日期。 */
  firstReleaseDate: IsoDate | null;
  /** event：開始時間（ISO 8601）；未定為 null。 */
  startTime: string | null;
  /** platform：縮寫。 */
  abbreviation: string | null;
  /** event：活動類型；platform：平台種類；franchise：franchise／collection（系列頁用 ?kind= 區分同 slug）；game、company 為 null。 */
  kind: string | null;
}

export const followTargetKey = (type: FollowTargetType, id: number): string => `${type}:${id}`;
