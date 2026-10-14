/**
 * 篩選條件的文字與 chip（純函式，只依賴字典與 Intl）。月曆、時間軸、熱門榜、瀏覽頁共用。
 */
import {
  FILTER_PARAMS,
  filterSpecToQueryString,
  isFilterDimension,
  removeFilterValue,
  setFilterParam,
  type FilterParam,
  type FilterScalarParam,
  type FilterSpec,
} from "@sok/api-contract";
import { formatIsoDate, translateLabel, type Locale, type Translator } from "@sok/i18n";
import type { FilterOptions } from "../../domain/entities";
import { genreLabel, platformKindLabel, regionLabel, stageLabel } from "../labels";
import { withQuery } from "../links";

/** 使用 FilterSpec 的頁面。 */
export type FilterPage = "calendar" | "timeline" | "trending" | "browse";

/**
 * 各頁適用的參數（spec 06 §篩選 表格）。不適用的參數在該頁靜默略過（不顯示 chip、不帶進連結）。
 * - 月曆：無 from／to（月份在路徑）。公司、系列聚合函式支援（G 判斷 7），保留。
 * - 時間軸：時間軸不含活動（G 判斷 12），沒有 show。
 * - 熱門榜：只有平台、平台類型、類型。
 * - 瀏覽（J）：依 spec 表格；stage／region 對瀏覽無作用（G 判斷 7）。J 可依實作調整。
 */
export const PAGE_FILTER_PARAMS: Readonly<Record<FilterPage, readonly FilterParam[]>> = {
  calendar: ["platform", "platformKind", "genre", "theme", "type", "stage", "status", "region", "minHeat", "show", "rumored", "company", "franchise"],
  timeline: ["platform", "platformKind", "genre", "theme", "type", "stage", "status", "region", "from", "to", "minHeat", "rumored", "company", "franchise"],
  trending: ["platform", "platformKind", "genre"],
  browse: [
    "platform",
    "platformKind",
    "genre",
    "theme",
    "type",
    "status",
    "year",
    "yearFrom",
    "yearTo",
    "minHeat",
    "rumored",
    "company",
    "franchise",
    "q",
    "sort",
  ],
};

/** 只留下該頁適用的參數（其他參數靜默略過）。沒有變動時回傳同一個物件。 */
export function filterSpecForPage(spec: FilterSpec, page: FilterPage): FilterSpec {
  const allowed = new Set<string>(PAGE_FILTER_PARAMS[page]);
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (allowed.has(k)) next[k] = v;
    else changed = true;
  }
  return changed ? (next as FilterSpec) : spec;
}

/** 某個參數值的顯示文字。 */
export interface FilterLabeler {
  (param: FilterParam, value: string): string;
}

/** 參數名稱（「平台」「地區偏好」…）。 */
export function filterParamLabel(t: Translator, param: FilterParam): string {
  return t.t(`filters.dimensions.${param}`);
}

export function themeLabel(t: Translator, slug: string, fallbackName?: string | null): string {
  return translateLabel(t, "themes", slug, fallbackName);
}

export function gameTypeLabel(t: Translator, type: string): string {
  return t.t(`enums.gameType.${type}`);
}

export function releaseStateLabel(t: Translator, state: string): string {
  return t.t(`filters.statusValues.${state}`);
}

export function showKindLabel(t: Translator, kind: string): string {
  return t.t(`filters.showValues.${kind}`);
}

export function minHeatLabel(t: Translator, level: number | string): string {
  return t.t("filters.minHeatValue", { level: String(level) });
}

/** options 可省略（熱門榜等只用部分維度的頁面；平台名稱查不到就顯示 slug）。 */
export function makeFilterLabeler(t: Translator, options: Pick<FilterOptions, "platforms" | "genres"> & Partial<Pick<FilterOptions, "themes">>): FilterLabeler {
  const locale: Locale = t.locale;
  const platformNames = new Map(options.platforms.map((p) => [p.slug, p.name]));
  const genreNames = new Map(options.genres.map((g) => [g.slug, g.name]));
  const themeNames = new Map((options.themes ?? []).map((g) => [g.slug, g.name]));
  return (param, value) => {
    switch (param) {
      case "platform":
        return platformNames.get(value) ?? value;
      case "platformKind":
        return platformKindLabel(t, value);
      case "genre":
        return genreLabel(t, value, genreNames.get(value));
      case "theme":
        return themeLabel(t, value, themeNames.get(value));
      case "type":
        return gameTypeLabel(t, value);
      case "stage":
        return stageLabel(t, value);
      case "status":
        return releaseStateLabel(t, value);
      case "show":
        return showKindLabel(t, value);
      case "region":
        return regionLabel(t, value);
      case "from":
      case "to":
        return formatIsoDate(value, locale, { dateStyle: "long" });
      case "minHeat":
        return minHeatLabel(t, value);
      case "rumored":
        return t.t("filters.rumoredValue");
      case "sort":
        return t.t(`filters.sortValues.${value}`);
      // company、franchise（slug；名稱由瀏覽頁另查）、year、yearFrom、yearTo、q：原值
      default:
        return value;
    }
  };
}

export interface AppliedChip {
  param: FilterParam;
  value: string;
  label: string;
  /** 移除這個條件後的網址。 */
  removeHref: string;
}

/**
 * 已套用條件的 chip（依 FILTER_PARAMS 順序；`sort` 不是篩選條件，不列）。
 * `extraQuery`：移除條件時要保留的非篩選參數（例如熱門榜的 `group`），不含 `?`。
 */
export function appliedChips(spec: FilterSpec, basePath: string, label: FilterLabeler, extraQuery = ""): AppliedChip[] {
  const out: AppliedChip[] = [];
  const href = (next: FilterSpec) => withQuery(basePath, [filterSpecToQueryString(next), extraQuery].filter(Boolean).join("&"));
  for (const param of FILTER_PARAMS) {
    if (param === "sort") continue;
    const raw = spec[param];
    if (raw === undefined) continue;
    if (isFilterDimension(param)) {
      for (const value of raw as readonly string[]) {
        out.push({ param, value, label: label(param, value), removeHref: href(removeFilterValue(spec, param, value as never)) });
      }
    } else {
      const value = String(raw);
      out.push({ param, value, label: label(param, value), removeHref: href(setFilterParam(spec, param as FilterScalarParam, undefined)) });
    }
  }
  return out;
}
