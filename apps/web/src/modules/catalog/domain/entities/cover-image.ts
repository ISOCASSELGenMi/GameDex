// 封面／截圖 URL（06 §遊戲詳情頁：換尺寸 token 依 viewport 選用）。
// 資料庫存的是 Provider 產生的完整 URL；讀取模型只傳圖片 id，由這裡組回指定尺寸。

export const IMAGE_SIZES = [
  "t_micro", "t_thumb", "t_cover_small", "t_cover_big", "t_logo_med",
  "t_screenshot_med", "t_screenshot_big", "t_screenshot_huge", "t_720p", "t_1080p",
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

const IMAGE_ID_RE = /\/t_[a-z0-9_]+\/([A-Za-z0-9_-]+)\.(?:jpg|jpeg|png|webp|gif)$/;

/** 從已存的 IGDB 圖片 URL 取出 image id；格式不符回 null。 */
export function parseImageId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = IMAGE_ID_RE.exec(url);
  return m ? m[1] : null;
}

/** 組出指定尺寸的圖片 URL（jpg）。 */
export function igdbImageUrl(imageId: string, size: ImageSize): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}
