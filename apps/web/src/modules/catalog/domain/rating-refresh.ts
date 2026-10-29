/**
 * 需要獨立請求的評分來源（目前只有 Metacritic）的分層更新頻率（05 §分層排程）。純函式。
 *
 * 以「上市期間的最後一天」為基準（月精度＝當月最後一天、季＝季末、年＝年末），避免太早抓：
 * | 距上市 | 頻率 |
 * | 上市前超過 7 天 | 不抓 |
 * | 上市前 7 天 ~ 上市後 14 天 | 每天 |
 * | 上市後 15~90 天 | 每週 |
 * | 上市後 90 天 ~ 2 年 | 每月 |
 * | 超過 2 年 | 不排程（nextRefreshAt = NULL） |
 */
import type { DatePrecision } from "./entities";

export const REFRESH_WINDOW_BEFORE_DAYS = 7;
export const REFRESH_WINDOW_AFTER_DAYS = 730;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC 當日 0 點的毫秒。 */
function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** 上市期間的最後一天（日精度＝當天）。tbd 或無日期回 null。 */
export function periodEndDate(releaseDate: string | null, precision: DatePrecision | null): string | null {
  if (!releaseDate || precision === "tbd") return null;
  const d = new Date(`${releaseDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  let end: Date;
  if (precision === "month") end = new Date(Date.UTC(y, m + 1, 0));
  else if (precision === "quarter") end = new Date(Date.UTC(y, Math.floor(m / 3) * 3 + 3, 0));
  else if (precision === "year") end = new Date(Date.UTC(y, 12, 0));
  else end = d;
  return end.toISOString().slice(0, 10);
}

/** 以今天（UTC 日期字串）看，這款遊戲落在哪個頻率；null＝不抓／不排程。 */
export function refreshIntervalDays(periodEnd: string | null, today: string): 1 | 7 | 30 | null {
  if (!periodEnd) return null;
  const sinceRelease = Math.round((dayMs(today) - dayMs(periodEnd)) / DAY_MS);
  if (sinceRelease < -REFRESH_WINDOW_BEFORE_DAYS) return null;
  if (sinceRelease <= 14) return 1;
  if (sinceRelease <= 90) return 7;
  if (sinceRelease <= REFRESH_WINDOW_AFTER_DAYS) return 30;
  return null;
}

/** 這次抓完之後下次可以抓的時間；不排程回 null。 */
export function nextRefreshAt(releaseDate: string | null, precision: DatePrecision | null, now: Date): Date | null {
  const interval = refreshIntervalDays(periodEndDate(releaseDate, precision), now.toISOString().slice(0, 10));
  return interval === null ? null : new Date(now.getTime() + interval * DAY_MS);
}
