/**
 * 卡片動作的掛載點（D83）：月曆與時間軸的遊戲卡片旁邊放一個空的 <span>，帶遊戲 id 與名稱。
 * catalog 不知道有誰會用它；accounts 啟用時，由 slot `card.actions` 提供的客戶端元件在掛載後登入檢查、批次查詢追蹤狀態，
 * 再用 portal 把追蹤按鈕放進這些掛載點。伺服器 HTML（與未啟用 accounts 時）它永遠是空的，所以頁面內容與使用者無關、可被 CDN 快取。
 * 沒有子節點，React 不會重寫它的內容，portal 放進去的按鈕不會被清掉。
 */
import type { ReactElement } from "react";

export const CARD_ACTION_HOST_ATTR = "data-card-action-game";

export function CardActionHost({ gameId, name }: { gameId: number; name: string }): ReactElement {
  return <span className="card-action" {...{ [CARD_ACTION_HOST_ATTR]: gameId }} data-card-action-name={name} />;
}
