/**
 * 遊玩紀錄的顯示與輸入換算（評分半分級、耗時小時＋分鐘、狀態文案）的唯一實作。純函式；客戶端與測試共用。
 * 評分 API 用 ratingHalfSteps（1~20 整數，rating = halfSteps / 2）；耗時存分鐘。
 */
import { PLAY_MINUTES_MAX, RATING_HALF_STEPS_MAX, RATING_HALF_STEPS_MIN, halfStepsToScore, type PlayStatus } from "../domain/entities/play-records";
import { str } from "./str";
import type { AccountStrings } from "./strings";

/** 半分級（1~20）→ 顯示字串："0.5"…"10"（小數符號依 locale）。 */
export function formatRating(halfSteps: number, locale: string): string {
  return formatScore(halfStepsToScore(halfSteps) ?? 0, locale);
}

/** 0.5~10 的分數（含玩家平均的一位小數）→ 顯示字串。 */
export function formatScore(score: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(score);
}

/** 評分下拉的選項（1~20 半分級）。 */
export function ratingOptions(locale: string): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  for (let h = RATING_HALF_STEPS_MIN; h <= RATING_HALF_STEPS_MAX; h++) out.push({ value: h, label: formatRating(h, locale) });
  return out;
}

/** 分鐘 → { hours, minutes }。 */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export type MinutesParse = { ok: true; minutes: number | null } | { ok: false; code: "invalid" | "out_of_range" };

/** 「小時」「分鐘」兩個輸入欄 → 分鐘。兩欄都空＝null（未填）；不是非負整數＝invalid；超過上限＝out_of_range。 */
export function joinMinutes(hoursText: string, minutesText: string): MinutesParse {
  const h = hoursText.trim();
  const m = minutesText.trim();
  if (h === "" && m === "") return { ok: true, minutes: null };
  const digits = /^[0-9]{1,7}$/;
  if ((h !== "" && !digits.test(h)) || (m !== "" && !digits.test(m))) return { ok: false, code: "invalid" };
  const total = (h === "" ? 0 : Number(h)) * 60 + (m === "" ? 0 : Number(m));
  if (total > PLAY_MINUTES_MAX) return { ok: false, code: "out_of_range" };
  return { ok: true, minutes: total };
}

/** 耗時文案：「12 小時 30 分」；整點「12 小時」；不到一小時「45 分」。 */
export function formatPlayTime(strings: AccountStrings, totalMinutes: number): string {
  const { hours, minutes } = splitMinutes(totalMinutes);
  if (hours === 0) return str(strings, "play.duration.m", { m: String(minutes) });
  if (minutes === 0) return str(strings, "play.duration.h", { h: String(hours) });
  return str(strings, "play.duration.hm", { h: String(hours), m: String(minutes) });
}

export const playStatusLabel = (strings: AccountStrings, status: PlayStatus): string => str(strings, `play.status.${status}`);

const KNOWN_FIELD_CODES = ["required", "invalid", "too_long", "out_of_range", "duplicate", "too_many", "empty", "immutable", "before_started_on", "not_in_game"];

/** API 欄位錯誤碼 → 文案（找不到對應用通用的「格式不正確」）。清單與遊玩紀錄表單共用。 */
export function fieldErrorText(strings: AccountStrings, code: string): string {
  return str(strings, `error.field.${KNOWN_FIELD_CODES.includes(code) ? code : "invalid"}`);
}

