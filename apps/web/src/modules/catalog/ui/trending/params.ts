/**
 * 熱門榜的非篩選參數（純函式）：榜單（group）與頁碼（page）。
 */
import type { PopularityGroup } from "../../domain/entities";

/** 每頁筆數（getTrending 上限 100）。 */
export const TRENDING_PAGE_SIZE = 50;
/** 頁碼上限（熱門榜只做前 20 頁，避免無意義的深分頁）。 */
export const TRENDING_PAGE_MAX = 20;

/** `group=released` 才是已上市；其他（含缺少、拼錯）一律 upcoming。 */
export function parseTrendingGroup(value: string | null | undefined): PopularityGroup {
  return value === "released" ? "released" : "upcoming";
}

/** 1~TRENDING_PAGE_MAX 的整數；其他一律第 1 頁。 */
export function parseTrendingPage(value: string | null | undefined): number {
  if (!value || !/^\d{1,3}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= TRENDING_PAGE_MAX ? n : 1;
}
