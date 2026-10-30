// admin 的頁面內容（06：app/ 只放薄路由，內容在 modules/<name>/ui/）。只給 src/app 的薄路由 import。
export { ReportsAdminPage, type ReportsAdminPageProps } from "./reports-page";
export { SettingsAdminPage, type SettingsAdminPageProps, type ModuleStatusRow } from "./settings-page";
export { SyncAdminPage, type SyncAdminPageProps } from "./sync-page";
