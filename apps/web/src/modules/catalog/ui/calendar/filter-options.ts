/**
 * 篩選選項（平台、類型清單）變動很慢：以 "use cache" 快取 1 小時，避免每次月曆請求都查。
 */
import { cacheLife } from "next/cache";
import type { FilterOptions } from "../../domain/entities";
import { getFilterOptions } from "../../use-cases/read";

export async function loadFilterOptions(locale: string): Promise<FilterOptions> {
  "use cache";
  cacheLife("hours");
  return getFilterOptions({ locale });
}
