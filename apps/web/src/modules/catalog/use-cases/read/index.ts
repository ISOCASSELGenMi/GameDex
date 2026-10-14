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
export { getTimeline, expandTimelineGroup, getReleaseDateHistory, type GetTimelineInput, type ExpandTimelineGroupInput } from "./get-timeline";
export { browseGames, type BrowseGamesInput } from "./browse-games";
// Phase 3.5：sitemap
export { getSitemapCounts, listSitemapEntries, listSitemapSmall, type ListSitemapShardInput } from "./sitemap";
