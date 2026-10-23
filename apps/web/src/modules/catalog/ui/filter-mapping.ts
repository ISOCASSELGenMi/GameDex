/**
 * FilterSpec（@sok/api-contract，URL 狀態）↔ catalog 讀取條件的對應。**全站只有這一份**（原則五）。
 *
 * - `filterSpecToReleaseFilter`：遊戲／上市列層級的篩選（月曆、時間軸、瀏覽共用的 ReleaseFilter）。
 *   spec 06 的 `status`（upcoming／released／delayed）對應 `ReleaseFilter.releaseStates`，
 *   **不是** `ReleaseFilter.statuses`（那是上市列的原始 status，URL 不開放）。
 * - `filterSpecToReadQuery`：再加上不屬於 ReleaseFilter 的參數（region、from／to、year 範圍、q、sort、show），
 *   給各頁的 Use Case input 用。
 */
import {
  FILTER_PARAMS,
  isFilterDimension,
  isFilterParam,
  type FilterDimension,
  type FilterIssue,
  type FilterParam,
  type FilterSort,
  type FilterSpec,
} from "@sok/api-contract";
import type { IgnoredFilterValue, IsoDate, ReleaseFilter } from "../domain/entities";

export function filterSpecToReleaseFilter(spec: FilterSpec): ReleaseFilter {
  const out: ReleaseFilter = {};
  if (spec.platform?.length) out.platformSlugs = spec.platform;
  if (spec.platformKind?.length) out.platformKinds = spec.platformKind;
  if (spec.genre?.length) out.genreSlugs = spec.genre;
  if (spec.stage?.length) out.stages = spec.stage;
  if (spec.theme?.length) out.themeSlugs = spec.theme;
  if (spec.type?.length) out.gameTypes = spec.type;
  if (spec.status?.length) out.releaseStates = spec.status;
  if (spec.company?.length) out.companySlugs = spec.company;
  if (spec.franchise?.length) out.franchiseSlugs = spec.franchise;
  if (spec.minHeat !== undefined) out.minHeat = spec.minHeat;
  if (spec.rumored === true) out.includeRumored = true;
  return out;
}

/** 各頁 Use Case 需要的完整讀取條件。 */
export interface FilterReadQuery {
  filter: ReleaseFilter;
  /** URL `region`（未驗證是否存在；Use Case 以 resolveRegionPrefWithNotice 處理）；未給＝undefined（用預設）。 */
  regionPref?: string;
  /** 月曆以外：代表日期／期間範圍（時間軸比對 period_start）。 */
  from?: IsoDate;
  to?: IsoDate;
  /** 瀏覽：首發年份範圍。`year` 優先（yearFrom＝yearTo＝year）；yearFrom > yearTo 時對調。 */
  yearFrom?: number;
  yearTo?: number;
  /** 瀏覽：搜尋字串（未 tokenize）。 */
  q?: string;
  /** 瀏覽排序；預設 popularity。 */
  sort: FilterSort;
  /** 月曆：顯示遊戲上市、活動；`show` 未給＝只顯示遊戲（GameDex 第 2 輪：活動預設關閉，開關在月曆上方）。 */
  show: ShowSet;
}

/** 月曆「遊戲／活動」兩個顯示開關的狀態。 */
export interface ShowSet {
  releases: boolean;
  events: boolean;
}

/** `show` 未給的預設：只開遊戲。網址上不寫預設值。 */
export const DEFAULT_SHOW: ShowSet = { releases: true, events: false };

/**
 * FilterSpec 的 `show` → 開關狀態（月曆頁、day API 共用的唯一實作）。
 * 未給（或給的全是無效值，已被 parse 丟掉）＝預設；兩個都關不可能出現（沒有 releases 也沒有 events 的值不存在）。
 */
export function showFromSpec(spec: Pick<FilterSpec, "show">): ShowSet {
  if (!spec.show?.length) return { ...DEFAULT_SHOW };
  return { releases: spec.show.includes("releases"), events: spec.show.includes("events") };
}

export function filterSpecToReadQuery(spec: FilterSpec): FilterReadQuery {
  let yearFrom = spec.year ?? spec.yearFrom;
  let yearTo = spec.year ?? spec.yearTo;
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  return {
    filter: filterSpecToReleaseFilter(spec),
    ...(spec.region ? { regionPref: spec.region } : {}),
    ...(spec.from ? { from: spec.from } : {}),
    ...(spec.to ? { to: spec.to } : {}),
    ...(yearFrom !== undefined ? { yearFrom } : {}),
    ...(yearTo !== undefined ? { yearTo } : {}),
    ...(spec.q ? { q: spec.q } : {}),
    sort: spec.sort ?? "popularity",
    show: showFromSpec(spec),
  };
}

/** 反向（測試與日後 API 用）：ReleaseFilter → FilterSpec 多值維度的形狀（未正規化）。 */
export function releaseFilterToFilterSpecShape(filter: ReleaseFilter): Record<FilterDimension, readonly string[] | undefined> {
  return {
    platform: filter.platformSlugs,
    platformKind: filter.platformKinds,
    genre: filter.genreSlugs,
    theme: filter.themeSlugs,
    type: filter.gameTypes,
    stage: filter.stages,
    status: filter.releaseStates,
    show: undefined,
    company: filter.companySlugs,
    franchise: filter.franchiseSlugs,
  };
}

/** 被忽略的條件（格式錯誤＋查無此 slug／地區），給 UI 顯示提示。 */
export interface FilterNotice {
  /** URL 參數名稱（多值維度或單值參數）。 */
  dimension: FilterParam;
  /** 被忽略的值；tooMany 時為 undefined（整個參數被拒）。 */
  value?: string;
  reason: "invalid" | "unknown" | "tooMany";
}

/** 合併 parseFilterSpec 的 issues 與 catalog 回報的 ignored（未知 slug）。去重、依參數順序。 */
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
    if (isFilterParam(i.dimension)) push({ dimension: i.dimension, value: i.slug, reason: "unknown" });
  }
  const order = (d: FilterParam) => FILTER_PARAMS.indexOf(d);
  return out.sort((a, b) => order(a.dimension) - order(b.dimension));
}

/** FilterSpec 中被 catalog 忽略的值移除後的版本（讓 chip／連結不再帶著無效值）。 */
export function withoutIgnored(spec: FilterSpec, notices: readonly FilterNotice[]): FilterSpec {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const param of FILTER_PARAMS) {
    const raw = spec[param];
    if (raw === undefined) continue;
    const drop = new Set(notices.filter((n) => n.dimension === param && n.value !== undefined).map((n) => n.value));
    if (isFilterDimension(param)) {
      const values = raw as readonly string[];
      const kept = values.filter((v) => !drop.has(v));
      if (kept.length !== values.length) changed = true;
      if (kept.length > 0) next[param] = kept;
    } else if (drop.has(String(raw)) || (param === "region" && [...drop].some((d) => d?.toUpperCase() === raw))) {
      changed = true;
    } else {
      next[param] = raw;
    }
  }
  return changed ? (next as FilterSpec) : spec;
}
