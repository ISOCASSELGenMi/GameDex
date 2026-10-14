/**
 * 哪些篩選組合不該被索引（06 §篩選 SEO：多維組合頁 noindex；單一維度頁可索引）。純函式。
 * 搜尋結果頁（`q`）一律 noindex。`sort` 只是檢視方式，不算維度。
 */
import {
  FILTER_DIMENSIONS,
  parseFilterSpec,
  type FilterDimension,
  type FilterScalarParam,
  type FilterSpec,
} from "@sok/api-contract";
import type { RawSearchParams } from "./alternates";

const SCALAR_DIMENSIONS: readonly FilterScalarParam[] = ["region", "from", "to", "year", "yearFrom", "yearTo", "minHeat", "rumored"];

/** 已套用的篩選維度數（多值維度各算 1，單值條件各算 1；q、sort 不算）。 */
export function activeFilterDimensions(filter: FilterSpec): number {
  let n = 0;
  for (const d of FILTER_DIMENSIONS as readonly FilterDimension[]) if ((filter[d]?.length ?? 0) > 0) n += 1;
  for (const p of SCALAR_DIMENSIONS) if (filter[p] !== undefined) n += 1;
  return n;
}

export function shouldNoindexFilter(sp: RawSearchParams): boolean {
  const { filter } = parseFilterSpec(sp);
  return filter.q !== undefined || activeFilterDimensions(filter) >= 2;
}
