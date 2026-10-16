/** accounts 頁面的網址（純函式；客戶端也會用）。語系前綴一律 `/{locale}`。 */
export const ACCOUNT_PAGES = ["login", "signup", "forgot-password", "reset-password", "account"] as const;
export type AccountPage = (typeof ACCOUNT_PAGES)[number];

export function accountPageHref(locale: string, page: AccountPage, query = ""): string {
  return `/${locale}/${page}${query ? `?${query}` : ""}`;
}

/**
 * 登入後要回去的路徑：只接受站內相對路徑（`/…`，不能是 `//…` 或帶反斜線）。其他一律回預設。
 * 不 decode 之外的處理：URL 內含 `\`、控制字元、`//` 都視為不安全。
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
