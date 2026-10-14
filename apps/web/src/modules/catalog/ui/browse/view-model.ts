/**
 * 瀏覽頁 `/games` 的純邏輯（view-model）：分頁、表單欄位、排序選項。不碰 React／DB，方便單元測試。
 */
import { FILTER_DIMENSIONS, FILTER_SORTS, type FilterSort, type FilterSpec } from "@sok/api-contract";
import { BROWSE_OFFSET_MAX, BROWSE_PAGE_SIZE, BROWSE_SORTS } from "../../domain/entities";
import type { FilterField } from "../filters/filter-panel";

/** 篩選面板在瀏覽頁出現的欄位（q、年份、排序由搜尋表單處理）。stage／region／show／日期範圍對瀏覽無作用。 */
export const BROWSE_FILTER_FIELDS: readonly FilterField[] = ["platform", "platformKind", "genre", "theme", "type", "status", "minHeat", "rumored"];

/** 最後一個可用的頁碼：offset 不得超過 BROWSE_OFFSET_MAX（use case 超過回空頁）。 */
export const BROWSE_MAX_PAGE = Math.floor(BROWSE_OFFSET_MAX / BROWSE_PAGE_SIZE) + 1;

/** 瀏覽頁開放的排序（FILTER_SORTS 與 BROWSE_SORTS 取交集，順序依 BROWSE_SORTS）。 */
export const BROWSE_SORT_OPTIONS: readonly FilterSort[] = BROWSE_SORTS.filter((s): s is FilterSort => (FILTER_SORTS as readonly string[]).includes(s));

/** `?page=n`：1~BROWSE_MAX_PAGE 的整數，其他一律第 1 頁。 */
export function parseBrowsePage(value: string | null | undefined): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= BROWSE_MAX_PAGE ? n : 1;
}

export function browseOffset(page: number): number {
  return (Math.max(1, Math.floor(page)) - 1) * BROWSE_PAGE_SIZE;
}

export interface BrowsePagination {
  /** 上一頁的頁碼；第 1 頁為 null。 */
  prev: number | null;
  /** 下一頁的頁碼；沒有下一頁、或已到可瀏覽範圍的盡頭為 null。 */
  next: number | null;
  /** 還有更多結果但已到 offset 上限：UI 要說明並請使用者縮小條件。 */
  limitReached: boolean;
}

export function browsePagination(page: number, hasMore: boolean): BrowsePagination {
  const atLimit = page >= BROWSE_MAX_PAGE;
  return {
    prev: page > 1 ? page - 1 : null,
    next: hasMore && !atLimit ? page + 1 : null,
    limitReached: hasMore && atLimit,
  };
}

/** 本頁顯示的筆數範圍（1 起算）；沒有結果回 null。 */
export function browseRange(offset: number, count: number): { from: number; to: number } | null {
  return count > 0 ? { from: offset + 1, to: offset + count } : null;
}

export interface HiddenField {
  name: string;
  value: string;
}

/**
 * 搜尋表單要保留的篩選條件（隱藏欄位）：多值維度每個值一個欄位，單值參數各一個；
 * `exclude` 內的參數由表單自己的欄位提供，不重複帶。
 */
export function hiddenFilterFields(spec: FilterSpec, exclude: readonly string[]): HiddenField[] {
  const skip = new Set(exclude);
  const out: HiddenField[] = [];
  for (const [name, raw] of Object.entries(spec)) {
    if (skip.has(name) || raw === undefined) continue;
    if ((FILTER_DIMENSIONS as readonly string[]).includes(name)) {
      for (const v of raw as readonly string[]) out.push({ name, value: v });
    } else if (raw === true) {
      out.push({ name, value: "1" });
    } else {
      out.push({ name, value: String(raw) });
    }
  }
  return out;
}

/** 表單中年份欄位的顯示值：`year` 視為起訖相同。 */
export function yearFieldValues(spec: FilterSpec): { from: string; to: string } {
  const from = spec.year ?? spec.yearFrom;
  const to = spec.year ?? spec.yearTo;
  return { from: from === undefined ? "" : String(from), to: to === undefined ? "" : String(to) };
}
