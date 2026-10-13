/**
 * 外部連結的白名單（唯一實作）：只放行 http(s)。遊戲詳情的商店／官方連結、公司官網、活動直播與官網都經這裡；
 * 外部資料（IGDB、手動輸入）不可直接當 `javascript:`、`data:` 等網址放進 href。回傳正規化後的網址，不合格回 null。
 * 相對網址、空字串、無法解析者也回 null。
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
