import type { ReactNode } from "react";

/**
 * 頁面層級的擴充內容（D83）。薄路由從 UI slot 取得後傳入，catalog 不 import 任何可選模組。
 * - filterLinks：篩選區旁的連結（accounts 啟用時是「我的遊戲」）。連結本身與使用者無關。
 * - cardActions：頁面上一次性掛載的客戶端元件，負責卡片掛載點（CardActionHost）的動作（accounts：追蹤按鈕）。
 */
export interface PageSlots {
  filterLinks?: ReactNode;
  cardActions?: ReactNode;
}
