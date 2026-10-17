/**
 * 組織首頁連結（選填）。遊戲圖鑑掛在組織的子網域，header／footer 可放一個回組織首頁的連結。
 * 環境變數：ORG_HOME_URL（完整 https 網址）、ORG_NAME（顯示名稱，三語共用；沒設時用網址的主機名稱）。
 * 沒設或不是 https 網址 → null（連結完全不出現）。內容與使用者無關，可以放進可快取的 HTML。
 * 讀 `env.ORG_HOME_URL`（參數物件的屬性）而不是字面 process.env.*，避免建置時被內嵌（同 site-url.ts）。
 */
export interface OrgLink {
  href: string;
  name: string;
}

export function orgLink(env: Readonly<Record<string, string | undefined>> = process.env): OrgLink | null {
  const raw = env.ORG_HOME_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const name = env.ORG_NAME?.trim() || u.hostname;
    return { href: u.href, name };
  } catch {
    return null;
  }
}
