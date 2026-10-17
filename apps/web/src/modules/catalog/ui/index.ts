// catalog 的頁面內容（06：app/ 只放薄路由，內容在 modules/<name>/ui/）。只給 src/app 的薄路由 import。
export { CalendarMonthPage, calendarTitle, redirectToCurrentMonth, type SearchParamsRecord } from "./calendar/calendar-page";
export { GameDetailPage, loadGameDetail, type GameDetailSlots } from "./game/game-detail-page";
export { LocaleBody, NotFoundView } from "./layout/locale-body";
// 其他模組的頁面（accounts 的登入頁等）由薄路由包上同一個 header／main
export { PageShell } from "./layout/page-shell";

export { parseMonthParam } from "./month";

// Phase 3b（I）：時間軸、熱門榜（薄路由與 route handler 用）
export { TimelineViewPage, timelineTitle } from "./timeline/timeline-page";
export { timelineChunkResponse, timelineGroupResponse, timelineHistoryResponse } from "./timeline/api";
export { TrendingViewPage, trendingTitle } from "./trending/trending-page";

// Phase 3b（J1）：遊戲瀏覽／搜尋
export { GamesBrowsePage, gamesTitle } from "./browse/browse-page";

// Phase 3b（J2）：平台／公司／系列／活動頁
export type { EntityActionsRenderer, EntityActionsTarget } from "./entities/shared";
export { PlatformsOverviewPage, PlatformDetailPage, platformsTitle, platformPageTitle } from "./entities/platform-pages";
export { CompanyDetailPage, companyPageTitle, FranchiseDetailPage, franchisePageTitle } from "./entities/company-franchise-pages";
export { EventsListPage, EventDetailPage, eventsTitle, eventPageTitle, loadEventDetail } from "./events/events-pages";

// Phase 3.5：SEO／快取
export { STATIC_SHELL_SLUG } from "./seo/cache-tags";
export { seoMetadata, seoSlug, gameDetailMetadata, eventDetailMetadata } from "./seo/metadata";
export { PAGE_RULE, enumRule } from "./seo/alternates";
export { sitemapIndexResponse, sitemapShardResponse, robotsResponse } from "./seo/sitemap-routes";

// Phase 4：資料更正回報表單頁
export { ReportPage, reportTitle } from "./report/report-page";

// Phase 5：iCal 訂閱頁
export { SubscribePage, subscribeTitle, type SubscribeSlots } from "./subscribe/subscribe-page";
export { SubscribeClientsSection } from "./subscribe/clients-section";

// Phase 9 準備：法務與說明頁（資料來源、隱私權、服務條款、聯絡）
export { ABOUT_PAGES, ABOUT_DRAFT_DATE, AboutPageView, aboutTitle, isAboutPage, type AboutPage } from "./about/about-pages";
