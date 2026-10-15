/**
 * 篩選選項（平台、類型清單）變動很慢：以 "use cache" 快取 1 小時，避免每次月曆請求都查。
 * 查詢逾時要在快取函式內攔下（見 page-errors.ts 的 `use cache` 邊界說明），否則頁面看不出是逾時。
 */
import { cacheLife } from "next/cache";
import type { FilterOptions } from "../../domain/entities";
import { getFilterOptions } from "../../use-cases/read";
import { timeoutMarkerOrRethrow, unwrapCachedForPage, type CachedTimeout } from "../page-errors";

async function readFilterOptionsCached(locale: string): Promise<FilterOptions | CachedTimeout> {
  "use cache";
  try {
    const options = await getFilterOptions({ locale });
    cacheLife("hours");
    return options;
  } catch (err) {
    const marker = timeoutMarkerOrRethrow(err);
    cacheLife("seconds"); // 逾時結果幾乎不快取：下一個請求就重試
    return marker;
  }
}

/** 逾時丟 QueryTimeoutPageError（頁面錯誤邊界顯示「縮小範圍」提示）；頁面的 try/catch 內呼叫。 */
export async function loadFilterOptions(locale: string): Promise<FilterOptions> {
  return unwrapCachedForPage(await readFilterOptionsCached(locale));
}
