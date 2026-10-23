/**
 * 站內玩家平均 → ratings（評分排名頁的 `players` 欄）。由 accounts 的排程任務經 catalog 公開 API 呼叫（02：寫入經擁有者）。
 * 輸入的 entries 已經是「達人數門檻」的玩家平均；這裡只驗證格式、整批取代。
 */
import { replaceSitePlayerRatings, type SitePlayerRatingInput } from "../repository/ratings";

export type { SitePlayerRatingInput };

export async function publishSitePlayerRatings(
  entries: readonly SitePlayerRatingInput[],
): Promise<{ upserted: number; deleted: number }> {
  const seen = new Set<number>();
  const clean: SitePlayerRatingInput[] = [];
  for (const e of entries) {
    if (!Number.isInteger(e.gameId) || !Number.isInteger(e.score) || !Number.isInteger(e.reviewCount)) continue;
    if (e.score < 0 || e.score > 100 || e.reviewCount < 1 || seen.has(e.gameId)) continue;
    seen.add(e.gameId);
    clean.push(e);
  }
  return replaceSitePlayerRatings(clean);
}
