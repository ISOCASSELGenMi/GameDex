import type { HomeDashboard } from "../../domain/entities";
import { addDaysIso, HOME_EVENT_DAYS, HOME_EVENT_LIMIT, HOME_RECENT_DAYS, HOME_SECTION_LIMIT, HOME_TRENDING_LIMIT, HOME_UPCOMING_DAYS, pickHomeCards } from "../../domain/home-dashboard";
import { utcToday } from "../../domain/utc-date";
import { getTrending } from "./get-trending";
import { listEvents } from "./list-events";
import { listReleaseCards } from "./list-release-cards";

export interface GetHomeDashboardInput {
  locale: string;
  /** 「現在」；測試用，預設現在。 */
  now?: Date;
}

/**
 * 首頁儀表板（GameDex 第 2 段）：即將上市（今天起 30 天）、最新上市（前 30 天到昨天）、近期活動（進行中＋30 天內開始）、近期熱門（即將上市／已上市兩群各自排名）。
 * 上市資料一律經 listReleaseCards（聚合規則只有一份），只取 day 精度（有確切日期才能「近到遠」排序），
 * 每區最多 HOME_SECTION_LIMIT 款，一款遊戲只出現一次。逾時丟 CatalogQueryTimeoutError。
 */
export async function getHomeDashboard(input: GetHomeDashboardInput): Promise<HomeDashboard> {
  const today = utcToday(input.now);
  const [upcoming, recent, events, trendingUpcoming, trendingReleased] = await Promise.all([
    listReleaseCards({ from: today, to: addDaysIso(today, HOME_UPCOMING_DAYS), precisions: ["day"], locale: input.locale }),
    listReleaseCards({ from: addDaysIso(today, -HOME_RECENT_DAYS), to: addDaysIso(today, -1), precisions: ["day"], locale: input.locale }),
    listEvents({ scope: "upcoming", page: 1, pageSize: HOME_EVENT_LIMIT, now: input.now, startsWithinDays: HOME_EVENT_DAYS }),
    getTrending({ group: "upcoming", locale: input.locale, limit: HOME_TRENDING_LIMIT, today }),
    getTrending({ group: "released", locale: input.locale, limit: HOME_TRENDING_LIMIT, today }),
  ]);
  return {
    today,
    upcoming: pickHomeCards(upcoming.cards, HOME_SECTION_LIMIT, "asc"),
    recent: pickHomeCards(recent.cards, HOME_SECTION_LIMIT, "desc"),
    events: events.items,
    trending: { upcoming: trendingUpcoming.items, released: trendingReleased.items },
    trendingRankedBy: trendingUpcoming.rankedBy ?? trendingReleased.rankedBy ?? "popularity",
  };
}
