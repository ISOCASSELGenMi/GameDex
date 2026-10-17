/**
 * 平台「分組」規則（唯一實作，原則五）。資料層的 kind 值不變（Switch 系列仍是 `hybrid`），
 * 只有呈現與篩選時，混合型平台同時屬於「主機」與「掌機」兩組，不獨立成一組（2026-10-17 使用者決定）。
 */
import type { PlatformKind } from "./entities/enums";

/** 平台總覽、選擇器的分組順序（mobile 不列；hybrid 不是分組）。 */
export const PLATFORM_GROUP_KINDS: readonly PlatformKind[] = ["console", "handheld", "pc", "arcade", "other"];

/** 一個平台（依其 kind）要出現在哪些分組。hybrid → 主機＋掌機。 */
export function platformGroupsFor(kind: PlatformKind): readonly PlatformKind[] {
  return kind === "hybrid" ? ["console", "handheld"] : [kind];
}

/**
 * 篩選「依平台種類」時實際要比對的 kind 集合：選主機或掌機時也含 hybrid；
 * 單選 hybrid（舊網址 platformKind=hybrid）維持只比對 hybrid。
 */
export function expandPlatformKindFilter(kinds: readonly PlatformKind[]): PlatformKind[] {
  const out = new Set<PlatformKind>(kinds);
  if (out.has("console") || out.has("handheld")) out.add("hybrid");
  return [...out];
}
