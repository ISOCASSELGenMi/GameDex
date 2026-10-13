// catalog 的頁面內容（06：app/ 只放薄路由，內容在 modules/<name>/ui/）。只給 src/app 的薄路由 import。
export { CalendarMonthPage, calendarTitle, redirectToCurrentMonth, type SearchParamsRecord } from "./calendar/calendar-page";
export { GameDetailPage, loadGameDetail, type GameDetailSlots } from "./game/game-detail-page";
export { LocaleBody, NotFoundView } from "./layout/locale-body";

export { parseMonthParam } from "./month";
