/**
 * 篩選條件正規化（06 §篩選）：純函式，不查資料庫。
 * - 同維度 OR、跨維度 AND；值一律 slug／enum 值，去重、轉小寫。
 * - 未知值忽略並回報（不 throw）；單一維度最多 MAX_FILTER_VALUES 個值，超過的忽略並回報。
 * - 某維度給了值但全部無效 → 該維度視為未指定（平台、類型、平台種類＝不限制；階段、遊戲類型、狀態＝預設值）。
 */
import {
  GAME_TYPES,
  PLATFORM_KINDS,
  RELEASE_STAGES,
  RELEASE_STATUSES,
  SEED_REGIONS,
  type IgnoredFilterValue,
  type PlatformKind,
  type RegionCode,
  type ReleaseFilter,
  type ReleaseFilterDimension,
  type ReleaseStage,
  type ReleaseStatus,
} from "./entities";

export const MAX_FILTER_VALUES = 20;

/** cancelled 預設不顯示（spec 未明文，採保守做法，見 Phase 3a 報告待決）。 */
export const DEFAULT_RELEASE_STATUSES: readonly ReleaseStatus[] = ["scheduled", "delayed", "released"];

export interface ReleaseFilterDefaults {
  /** CALENDAR_VISIBLE_GAME_TYPES */
  gameTypes: readonly string[];
  /** CALENDAR_VISIBLE_RELEASE_STAGES */
  stages: readonly string[];
}

export interface NormalizedReleaseFilter {
  /** undefined＝不限制。 */
  platformSlugs?: string[];
  platformKinds?: PlatformKind[];
  genreSlugs?: string[];
  stages: ReleaseStage[];
  gameTypes: string[];
  statuses: ReleaseStatus[];
  includeRumored: boolean;
  ignored: IgnoredFilterValue[];
}

const SELECTABLE_KINDS = PLATFORM_KINDS.filter((k) => k !== "mobile");

function clean(values: readonly string[] | undefined, dim: ReleaseFilterDimension, ignored: IgnoredFilterValue[]): string[] | undefined {
  if (!values) return undefined;
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw).trim().toLowerCase();
    if (!v || out.includes(v)) continue;
    if (out.length >= MAX_FILTER_VALUES) {
      ignored.push({ dimension: dim, slug: v });
      continue;
    }
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

function pickEnum<T extends string>(
  values: readonly string[] | undefined,
  allowed: readonly T[],
  dim: ReleaseFilterDimension,
  ignored: IgnoredFilterValue[],
): T[] | undefined {
  const cleaned = clean(values, dim, ignored);
  if (!cleaned) return undefined;
  const ok: T[] = [];
  for (const v of cleaned) {
    if ((allowed as readonly string[]).includes(v)) ok.push(v as T);
    else ignored.push({ dimension: dim, slug: v });
  }
  return ok.length > 0 ? ok : undefined;
}

/** 環境變數的預設值也過濾一次（設定錯字不讓查詢失敗；全部無效時退回規格預設）。 */
function validDefaults<T extends string>(values: readonly string[], allowed: readonly T[], fallback: readonly T[]): T[] {
  const ok = values.filter((v): v is T => (allowed as readonly string[]).includes(v));
  return ok.length > 0 ? [...new Set(ok)] : [...fallback];
}

export function normalizeReleaseFilter(filter: ReleaseFilter, defaults: ReleaseFilterDefaults): NormalizedReleaseFilter {
  const ignored: IgnoredFilterValue[] = [];
  const platformSlugs = clean(filter.platformSlugs, "platform", ignored);
  const genreSlugs = clean(filter.genreSlugs, "genre", ignored);
  const platformKinds = pickEnum(filter.platformKinds, SELECTABLE_KINDS, "platformKind", ignored);
  const stages =
    pickEnum(filter.stages, RELEASE_STAGES, "stage", ignored) ??
    validDefaults(defaults.stages, RELEASE_STAGES, ["unspecified", "full", "early_access"]);
  const gameTypes =
    pickEnum(filter.gameTypes, GAME_TYPES, "type", ignored) ??
    validDefaults(defaults.gameTypes, GAME_TYPES, ["main_game", "standalone_expansion", "remake", "remaster", "port"]);
  const statuses = pickEnum(filter.statuses, RELEASE_STATUSES, "status", ignored) ?? [...DEFAULT_RELEASE_STATUSES];
  return {
    ...(platformSlugs ? { platformSlugs } : {}),
    ...(platformKinds ? { platformKinds } : {}),
    ...(genreSlugs ? { genreSlugs } : {}),
    stages,
    gameTypes,
    statuses,
    includeRumored: filter.includeRumored === true,
    ignored,
  };
}

const REGION_CODES = SEED_REGIONS.map((r) => r.code);

/** 地區偏好：已知的 regions.code（不分大小寫）→ 否則 fallback（DEFAULT_REGION_PREF）→ 否則 WW。 */
export function normalizeRegionPref(code: string | null | undefined, fallback: string | null | undefined): RegionCode {
  for (const c of [code, fallback]) {
    const v = c?.trim().toUpperCase();
    if (v && REGION_CODES.includes(v)) return v;
  }
  return "WW";
}

/** 月份的第一天與最後一天（UTC 曆法）。無效年月丟 RangeError（UI 應先驗證）。 */
export function monthBounds(year: number, month: number): { first: string; last: string } {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 1900 || year > 2200) {
    throw new RangeError(`無效的年月：${year}-${month}`);
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}
