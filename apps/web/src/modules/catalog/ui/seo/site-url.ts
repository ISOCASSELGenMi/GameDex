/**
 * 站台網址（canonical、hreflang、sitemap、JSON-LD 的絕對網址來源）。
 * 來源：環境變數 NEXT_PUBLIC_SITE_URL（16 §環境變數，例 https://sok-studio.com）。沒設時回 null，
 * 呼叫端退回相對網址（頁面 metadata）或請求的 origin（sitemap 路由）。
 *
 * 刻意用 `env.NEXT_PUBLIC_SITE_URL`（參數物件的屬性）而不是字面的 `process.env.NEXT_PUBLIC_SITE_URL`：
 * 後者會在建置時被內嵌成常數，之後改環境變數要重建；前者執行時才讀。
 */
export type SiteEnv = Readonly<Record<string, string | undefined>>;

/** 去掉結尾斜線與路徑，只留 origin；不是 http(s) 網址 → null。 */
export function siteOrigin(env: SiteEnv = process.env): string | null {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** origin 為 null 時回相對路徑。path 必須以 `/` 開頭。 */
export function absoluteUrl(origin: string | null, path: string): string {
  return origin ? `${origin}${path}` : path;
}
