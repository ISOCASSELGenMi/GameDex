/**
 * 追蹤（03 §follows、09 §追蹤、D48）：我方型別與驗證規則。純函式、零外部依賴。
 * 目標種類與 catalog 的 FOLLOW_TARGET_TYPES 一致（單元測試比對；accounts 的 domain/schema 不能 import catalog）。
 * 追蹤清單不公開（D48）：沒有任何讀別人追蹤清單的端點；公開的只有「人數」，且低於 FOLLOW_COUNT_MIN_DISPLAY 不顯示。
 */
import type { Validated } from "./lists";

export const FOLLOW_TARGETS = ["game", "event", "platform", "franchise", "company"] as const;
export type FollowTarget = (typeof FOLLOW_TARGETS)[number];

export function isFollowTarget(value: unknown): value is FollowTarget {
  return typeof value === "string" && (FOLLOW_TARGETS as readonly string[]).includes(value);
}

/** FOLLOW_MAX_PER_DAY 預設：每人每個滾動 24 小時最多新增這麼多筆追蹤（防灌水，03 §熱度）。 */
export const FOLLOW_MAX_PER_DAY_DEFAULT = 200;
/** 滾動視窗長度。 */
export const FOLLOW_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** FOLLOW_MAX_PER_DAY：正整數；未設或不合法用預設 200。 */
export function resolveFollowMaxPerDay(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return FOLLOW_MAX_PER_DAY_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : FOLLOW_MAX_PER_DAY_DEFAULT;
}

/** GET /follows 分頁。 */
export const FOLLOW_LIST_LIMIT_DEFAULT = 50;
export const FOLLOW_LIST_LIMIT_MAX = 100;
/** GET /me/follows/state 一次最多查幾個目標。 */
/** 一次最多查幾個目標的追蹤狀態（月曆一頁的卡片可能上百張，D83 由 100 調到 300）。 */
export const FOLLOW_STATE_TARGETS_MAX = 300;

export interface FollowTargetKey {
  targetType: FollowTarget;
  targetId: number;
}

const ID_PATTERN = /^[0-9]{1,10}$/;

function parseTargetId(raw: string): number | null {
  if (!ID_PATTERN.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** 路徑參數 `{targetType}/{targetId}`；種類不認得或 id 不是正整數 → null（呼叫端回 404）。 */
export function parseFollowPath(typeParam: string, idParam: string): FollowTargetKey | null {
  if (!isFollowTarget(typeParam)) return null;
  const id = parseTargetId(idParam);
  return id === null ? null : { targetType: typeParam, targetId: id };
}

/** `targets=game:1,event:2`：去重、保留順序；格式錯誤 invalid、超過上限 too_many、空 required。 */
export function parseStateTargets(raw: string | null): Validated<FollowTargetKey[]> {
  if (raw === null || raw.trim() === "") return { ok: false, fields: { targets: "required" } };
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return { ok: false, fields: { targets: "required" } };
  if (parts.length > FOLLOW_STATE_TARGETS_MAX) return { ok: false, fields: { targets: "too_many" } };
  const out: FollowTargetKey[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const [t, i, ...rest] = p.split(":");
    if (rest.length > 0 || t === undefined || i === undefined) return { ok: false, fields: { targets: "invalid" } };
    const key = parseFollowPath(t, i);
    if (!key) return { ok: false, fields: { targets: "invalid" } };
    const k = `${key.targetType}:${key.targetId}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(key);
    }
  }
  return { ok: true, value: out };
}
