/**
 * 遊玩紀錄（09 §遊玩紀錄、03 play_records）：我方型別與驗證規則。純函式、零外部依賴。
 * 以「用戶 × 遊戲」為單位，一款遊戲可多筆。評分存半分級 1~20（0.5~10 分，P42）。
 */
import { REVIEW_VISIBILITIES } from "./providers";
import type { FieldErrors, Validated } from "./lists";

/** 想玩／正在玩／玩完／全破／暫停／放棄（P36）。schema 以這些值建 pgEnum。 */
export const PLAY_STATUSES = ["want_to_play", "playing", "finished", "completed", "paused", "abandoned"] as const;
export type PlayStatus = (typeof PLAY_STATUSES)[number];
export function isPlayStatus(v: unknown): v is PlayStatus {
  return typeof v === "string" && (PLAY_STATUSES as readonly string[]).includes(v);
}
/** 「玩完」類狀態（統計今年完成數、玩家平均耗時用）。 */
export const FINISHED_STATUSES: readonly PlayStatus[] = ["finished", "completed"];

export type ReviewVisibility = (typeof REVIEW_VISIBILITIES)[number];
export function isReviewVisibility(v: unknown): v is ReviewVisibility {
  return typeof v === "string" && (REVIEW_VISIBILITIES as readonly string[]).includes(v);
}

export const RATING_HALF_STEPS_MIN = 1;
export const RATING_HALF_STEPS_MAX = 20;
/** 耗時上限：600000 分鐘＝10000 小時。 */
export const PLAY_MINUTES_MAX = 600_000;
export const REVIEW_MAX = 10_000;
export const PRIVATE_NOTE_MAX = 5_000;
/** 每位使用者的遊玩紀錄上限（防灌水）；超過回 422 play_record_limit_reached。 */
export const PLAY_RECORDS_MAX_PER_USER = 5_000;
export const PLAY_RECORDS_PAGE_DEFAULT = 50;
export const PLAY_RECORDS_PAGE_MAX = 100;

/** 半分級 → 0.5~10 分。 */
export function halfStepsToScore(halfSteps: number | null): number | null {
  return halfSteps === null ? null : halfSteps / 2;
}

/** 玩家平均（avg_half_steps，numeric）→ 0.5~10 的一位小數。 */
export function averageHalfStepsToScore(avgHalfSteps: number): number {
  return Math.round((avgHalfSteps / 2) * 10) / 10;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** YYYY-MM-DD 且是真實存在的日期（1950~2200）。 */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_PATTERN.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1950 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 完成日不得早於開始日（兩者都有才檢查）。 */
export function datesOrdered(startedOn: string | null, finishedOn: string | null): boolean {
  return startedOn === null || finishedOn === null || finishedOn >= startedOn;
}

export interface PlayRecordFields {
  platformId: number | null;
  status: PlayStatus;
  startedOn: string | null;
  finishedOn: string | null;
  playMinutes: number | null;
  ratingHalfSteps: number | null;
  review: string | null;
  reviewHasSpoilers: boolean;
  /** undefined＝建立時用 users.defaultReviewVisibility。 */
  reviewVisibility: ReviewVisibility | undefined;
  privateNote: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Patch = Partial<PlayRecordFields>;

/** 共用：逐欄位驗證 body 中「有出現」的欄位。nullable 欄位可傳 null 清除。 */
function readFields(body: Record<string, unknown>, fields: FieldErrors): Patch {
  const out: Patch = {};
  const has = (k: string) => k in body && body[k] !== undefined;

  if (has("status")) {
    if (isPlayStatus(body.status)) out.status = body.status;
    else fields.status = "invalid";
  }
  if (has("platformId")) {
    const v = body.platformId;
    if (v === null) out.platformId = null;
    else if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) out.platformId = v;
    else fields.platformId = "invalid";
  }
  for (const key of ["startedOn", "finishedOn"] as const) {
    if (!has(key)) continue;
    const v = body[key];
    if (v === null) out[key] = null;
    else if (isValidIsoDate(v)) out[key] = v;
    else fields[key] = "invalid";
  }
  if (has("playMinutes")) {
    const v = body.playMinutes;
    if (v === null) out.playMinutes = null;
    else if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= PLAY_MINUTES_MAX) out.playMinutes = v;
    else fields.playMinutes = typeof v === "number" && Number.isFinite(v) && (v < 0 || v > PLAY_MINUTES_MAX) ? "out_of_range" : "invalid";
  }
  if (has("ratingHalfSteps")) {
    const v = body.ratingHalfSteps;
    if (v === null) out.ratingHalfSteps = null;
    else if (typeof v === "number" && Number.isSafeInteger(v) && v >= RATING_HALF_STEPS_MIN && v <= RATING_HALF_STEPS_MAX) out.ratingHalfSteps = v;
    else fields.ratingHalfSteps = typeof v === "number" && Number.isFinite(v) ? "out_of_range" : "invalid";
  }
  for (const [key, max] of [
    ["review", REVIEW_MAX],
    ["privateNote", PRIVATE_NOTE_MAX],
  ] as const) {
    if (!has(key)) continue;
    const v = body[key];
    if (v === null) out[key] = null;
    else if (typeof v !== "string") fields[key] = "invalid";
    else if ([...v].length > max) fields[key] = "too_long";
    else out[key] = v.trim() === "" ? null : v;
  }
  if (has("reviewHasSpoilers")) {
    if (typeof body.reviewHasSpoilers === "boolean") out.reviewHasSpoilers = body.reviewHasSpoilers;
    else fields.reviewHasSpoilers = "invalid";
  }
  if (has("reviewVisibility")) {
    if (isReviewVisibility(body.reviewVisibility)) out.reviewVisibility = body.reviewVisibility;
    else fields.reviewVisibility = "invalid";
  }
  return out;
}

export interface PlayRecordCreateInput extends PlayRecordFields {
  gameId: number;
}

export function validatePlayRecordCreate(body: unknown): Validated<PlayRecordCreateInput> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  let gameId = 0;
  if (typeof body.gameId === "number" && Number.isSafeInteger(body.gameId) && body.gameId > 0) gameId = body.gameId;
  else fields.gameId = body.gameId === undefined ? "required" : "invalid";
  if (body.status === undefined) fields.status = "required";
  const p = readFields(body, fields);
  if (!datesOrdered(p.startedOn ?? null, p.finishedOn ?? null)) fields.finishedOn = "before_started_on";
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      gameId,
      status: p.status as PlayStatus,
      platformId: p.platformId ?? null,
      startedOn: p.startedOn ?? null,
      finishedOn: p.finishedOn ?? null,
      playMinutes: p.playMinutes ?? null,
      ratingHalfSteps: p.ratingHalfSteps ?? null,
      review: p.review ?? null,
      reviewHasSpoilers: p.reviewHasSpoilers ?? false,
      reviewVisibility: p.reviewVisibility,
      privateNote: p.privateNote ?? null,
    },
  };
}

/** PATCH：只含有出現的欄位；gameId 不可改。日期先後要與既有值合併後再檢查（use case 做，用 datesOrdered）。 */
export function validatePlayRecordPatch(body: unknown): Validated<Patch> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  if (body.gameId !== undefined) fields.gameId = "immutable";
  if (body.status === null) fields.status = "invalid";
  const p = readFields(body, fields);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(p).length === 0) return { ok: false, fields: { body: "empty" } };
  return { ok: true, value: p };
}

/** 遊玩紀錄在 API 的樣子（本人）。 */
export interface PlayRecordView {
  id: number;
  gameId: number;
  platformId: number | null;
  status: PlayStatus;
  startedOn: string | null;
  finishedOn: string | null;
  playMinutes: number | null;
  /** 1~20；NULL＝未評分。 */
  ratingHalfSteps: number | null;
  /** 0.5~10；NULL＝未評分（ratingHalfSteps / 2）。 */
  rating: number | null;
  review: string | null;
  reviewHasSpoilers: boolean;
  reviewVisibility: ReviewVisibility;
  privateNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 對外（非本人）可見的樣子：永遠不含 privateNote。social 模組之後顯示公開評論時用這個轉換，不要自己挑欄位。 */
export type PublicPlayRecordView = Omit<PlayRecordView, "privateNote">;
export function toPublicPlayRecord(view: PlayRecordView): PublicPlayRecordView {
  const { privateNote: _omit, ...rest } = view;
  void _omit;
  return rest;
}

export interface PlayStatsView {
  /** 各狀態的紀錄筆數（六種都有，沒有為 0）。 */
  byStatus: Record<PlayStatus, number>;
  total: number;
  /** 今年（UTC）完成的筆數：status 為 finished／completed 且 finishedOn 在今年。 */
  finishedThisYear: number;
  year: number;
  /** 所有紀錄 playMinutes 的總和。 */
  totalPlayMinutes: number;
}
