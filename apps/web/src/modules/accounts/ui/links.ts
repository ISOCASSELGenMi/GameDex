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
