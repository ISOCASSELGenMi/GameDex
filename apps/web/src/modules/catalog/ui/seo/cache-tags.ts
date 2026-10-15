/** `use cache` 的標籤前綴（revalidateTag 用）。同步寫入後要讓詳情頁提前更新時，對 `catalog:game:<slug>` 等標籤呼叫 revalidateTag。 */
export const CATALOG_TAG = "catalog";

/** 一款遊戲詳情頁的快取標籤（loadGameDetail 的 cacheTag 與回報核可後的 revalidateTag 共用同一個格式）。 */
export const gameDetailTag = (slug: string): string => `${CATALOG_TAG}:game:${slug}`;

/**
 * `generateStaticParams` 的佔位 slug（06 §SEO 與快取、ISR）：ensureStatic = "navigation" 的動態路由必須至少回傳一組完整參數，
 * 但建置時不能依賴資料庫（CI 的 core-only build 沒有 DB）。這個值不是任何真實 slug（含 `~`，slugify 不會產生），
 * 載入器遇到它直接回「找不到」，不碰 DB；其餘 slug 都是第一次請求時才產生並存入 ISR 快取。
 */
export const STATIC_SHELL_SLUG = "~static-shell";
