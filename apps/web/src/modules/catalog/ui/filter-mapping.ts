/**
 * FilterSpec（@sok/api-contract，URL 狀態）↔ catalog ReleaseFilter 的對應。**全站只有這一份**（原則五）。
 * 3a 維度：platform、platformKind、genre、stage。spec 06 的 status（upcoming／released／delayed）是 3b，
 * 不要對應到 ReleaseFilter.statuses（那是上市列的原始 status）。
 */
import { FILTER_DIMENSIONS, type FilterDimension, type FilterIssue, type FilterSpec } from "@sok/api-contract";
import type { IgnoredFilterValue, ReleaseFilter } from "../domain/entities";

export function filterSpecToReleaseFilter(spec: FilterSpec): ReleaseFilter {
  const out: {
    platformSlugs?: readonly string[];
    platformKinds?: readonly string[];
    genreSlugs?: readonly string[];
    stages?: readonly string[];
  } = {};
  if (spec.platform?.length) out.platformSlugs = spec.platform;
  if (spec.platformKind?.length) out.platformKinds = spec.platformKind;
  if (spec.genre?.length) out.genreSlugs = spec.genre;
  if (spec.stage?.length) out.stages = spec.stage;
  return out;
}

/** 反向（測試與日後 API 用）：ReleaseFilter 的 3a 維度 → FilterSpec 形狀（未正規化）。 */
export function releaseFilterToFilterSpecShape(filter: ReleaseFilter): Record<FilterDimension, readonly string[] | undefined> {
  return {
    platform: filter.platformSlugs,
    platformKind: filter.platformKinds,
    genre: filter.genreSlugs,
    stage: filter.stages,
  };
}

/** 被忽略的條件（格式錯誤＋查無此 slug），給 UI 顯示提示。 */
export interface FilterNotice {
  dimension: FilterDimension;
  /** 被忽略的值；tooMany 時為 undefined（整個參數被拒）。 */
  value?: string;
  reason: "invalid" | "unknown" | "tooMany";
}

function isFilterDimension(d: string): d is FilterDimension {
  return (FILTER_DIMENSIONS as readonly string[]).includes(d);
}

/** 合併 parseFilterSpec 的 issues 與 catalog 回報的 ignored（未知 slug）。去重、依維度順序。 */
export function collectFilterNotices(issues: readonly FilterIssue[], ignored: readonly IgnoredFilterValue[]): FilterNotice[] {
  const out: FilterNotice[] = [];
  const seen = new Set<string>();
  const push = (n: FilterNotice) => {
    const key = `${n.dimension}|${n.value ?? ""}|${n.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };
  for (const i of issues) {
    push({ dimension: i.param, value: i.value, reason: i.reason === "too_many_values" ? "tooMany" : "invalid" });
  }
  for (const i of ignored) {
    if (isFilterDimension(i.dimension)) push({ dimension: i.dimension, value: i.slug, reason: "unknown" });
  }
  const order = (d: FilterDimension) => FILTER_DIMENSIONS.indexOf(d);
  return out.sort((a, b) => order(a.dimension) - order(b.dimension));
}

/** FilterSpec 中被 catalog 忽略的值移除後的版本（讓 chip／連結不再帶著無效值）。 */
export function withoutIgnored(spec: FilterSpec, notices: readonly FilterNotice[]): FilterSpec {
  let changed = false;
  const next: Record<string, readonly string[]> = {};
  for (const dim of FILTER_DIMENSIONS) {
    const values = spec[dim] as readonly string[] | undefined;
    if (!values) continue;
    const drop = new Set(notices.filter((n) => n.dimension === dim && n.value !== undefined).map((n) => n.value));
    const kept = values.filter((v) => !drop.has(v));
    if (kept.length !== values.length) changed = true;
    if (kept.length > 0) next[dim] = kept;
  }
  return changed ? (next as FilterSpec) : spec;
}
