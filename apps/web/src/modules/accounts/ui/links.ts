/** accounts 頁面的網址（純函式；客戶端也會用）。語系前綴一律 `/{locale}`。 */
import { safeRelativePath } from "../domain/entities/safe-path";

export const ACCOUNT_PAGES = ["login", "signup", "forgot-password", "reset-password", "account"] as const;
export type AccountPage = (typeof ACCOUNT_PAGES)[number];

export function accountPageHref(locale: string, page: AccountPage, query = ""): string {
  return `/${locale}/${page}${query ? `?${query}` : ""}`;
}

/** 登入後要回去的路徑：只接受站內相對路徑，其他一律回預設（唯一實作在 domain/entities/safe-path.ts）。 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  return safeRelativePath(next, fallback);
}

/** 帳號下的子頁（第 5 波）：我的清單、清單內容、遊玩紀錄。 */
export function accountListsHref(locale: string): string {
  return `/${locale}/account/lists`;
}
export function accountListHref(locale: string, listId: number): string {
  return `/${locale}/account/lists/${listId}`;
}
export function accountPlaysHref(locale: string): string {
  return `/${locale}/account/plays`;
}
/** 公開清單頁：public 用 id；unlisted 用 shareToken。 */
export function publicListHref(locale: string, list: { id: number; visibility: string; shareToken: string | null }): string {
  return list.visibility === "unlisted" && list.shareToken ? `/${locale}/lists/s/${encodeURIComponent(list.shareToken)}` : `/${locale}/lists/${list.id}`;
}

/** 第 6 波：我的追蹤、我的遊戲、私人行事曆。 */
export function accountFollowsHref(locale: string): string {
  return `/${locale}/account/follows`;
}
export function accountGamesHref(locale: string, query = ""): string {
  return `/${locale}/account/games${query ? `?${query}` : ""}`;
}
export function accountPrivateCalendarHref(locale: string): string {
  return `/${locale}/account/calendar`;
}

/** 第 7 波：帳號設定、隱私與資料（匯出、刪除）、刪除完成。 */
export function accountSettingsHref(locale: string): string {
  return `/${locale}/account/settings`;
}
export function accountPrivacyHref(locale: string): string {
  return `/${locale}/account/privacy`;
}
export function accountDeletedHref(locale: string): string {
  return `/${locale}/account/deleted`;
}
