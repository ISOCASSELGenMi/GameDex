// 讀取用 Use Case（Phase 3a）。UI 經 catalog/index.ts 使用。
export { getCalendarMonth, type GetCalendarMonthInput } from "./get-calendar-month";
export { getGameDetail, type GetGameDetailInput } from "./get-game-detail";
export { getFilterOptions, type GetFilterOptionsInput } from "./get-filter-options";
export { listReleaseCards, type ListReleaseCardsInput } from "./list-release-cards";
export { resolveFilterSlugs, resolveRegionPref, type ResolvedFilterResult } from "./resolve-filter";
// Phase 3b（H）：平台／公司／系列頁、活動
export { listPlatforms, type ListPlatformsInput } from "./list-platforms";
export { getPlatformPage, type GetPlatformPageInput } from "./get-platform-page";
export { getCompanyPage, type GetCompanyPageInput } from "./get-company-page";
export { getFranchisePage, type GetFranchisePageInput } from "./get-franchise-page";
export { listEvents, EVENT_LIST_DEFAULT_PAGE_SIZE, EVENT_LIST_MAX_PAGE_SIZE, type ListEventsInput } from "./list-events";
export { getEventDetail, type GetEventDetailInput } from "./get-event-detail";
// Phase 3b（F）：熱門榜
export { getTrending, TRENDING_DEFAULT_LIMIT, TRENDING_MAX_LIMIT, type GetTrendingInput } from "./get-trending";
// Phase 3b（G）：時間軸、瀏覽／搜尋
export { browseGames, type BrowseGamesInput } from "./browse-games";
// Phase 3.5：sitemap
export { getSitemapCounts, listSitemapEntries, listSitemapSmall, type ListSitemapShardInput } from "./sitemap";
// Phase 4：評分顯示設定（環境變數驗證）
export { getRatingDisplayConfig, validateRatingDisplayEnv } from "./rating-config";
// Phase 7 第 6 波：我的遊戲
export { getMyGames, pickNextRelease, type GetMyGamesInput } from "./get-my-games";
// GameDex 第 2 段：首頁儀表板
export { getHomeDashboard, type GetHomeDashboardInput } from "./get-home-dashboard";
// GameDex 第 3 段（X1）：月曆單日（格內切換按需載入）
export { getCalendarDay, type GetCalendarDayInput, type CalendarDay } from "./get-calendar-day";
// GameDex 第 3 段（X2）：時間軸一週
export { getTimelineWeek, type GetTimelineWeekInput, type TimelineWeek, type TimelineWeekDay } from "./get-timeline-week";
// GameDex 第 2 輪（Z2B）：評分排名
export { getRatingsRanking, getRatingColumns, type GetRatingsRankingInput } from "./get-ratings-ranking";
// GameDex 第 2 輪（Z2A）：瀏覽頁分組檢視（依日期／平台／廠商）
export {
  getGameGroups,
  getGameGroupPage,
  normalizeGroupOrder,
  isGroupKey,
  type GetGameGroupsInput,
  type GetGameGroupPageInput,
  type GameGroups,
} from "./get-game-groups";
