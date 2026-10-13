/**
 * IGDB 圖片 CDN 網址 → ImageRef（原則二：IGDB 網址格式與尺寸 token 只存在 Provider 層）。
 * 同步時存進資料庫的是 igdbImageUrl() 產生的完整網址（封面 t_cover_big、截圖 t_screenshot_big，jpg）；
 * 讀取時由這裡換成各尺寸。
 */
import type { ImageKind, ImageRef } from "../../domain/entities";
import { igdbImageUrl } from "./mappings";

const IGDB_IMAGE_RE =
  /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_[a-z0-9_]+\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp|gif)$/;

/** 各用途的尺寸 token（06 §封面圖）。 */
const SIZE_TOKENS: Readonly<Record<ImageKind, { small: string; medium: string; large: string }>> = {
  cover: { small: "t_cover_small", medium: "t_cover_big", large: "t_1080p" },
  screenshot: { small: "t_screenshot_med", medium: "t_screenshot_big", large: "t_1080p" },
};

/** 從 IGDB 圖片網址取出 image id；不是 IGDB 圖片網址回 null。 */
export function parseIgdbImageId(url: string): string | null {
  return IGDB_IMAGE_RE.exec(url)?.[1] ?? null;
}

/** IGDB 圖片網址 → ImageRef（各尺寸換 token，jpg）；不是 IGDB 圖片網址回 null（由呼叫端決定 fallback）。 */
export function igdbImageRef(url: string, kind: ImageKind): ImageRef | null {
  const id = parseIgdbImageId(url);
  if (!id) return null;
  const t = SIZE_TOKENS[kind];
  const at = (size: string) => igdbImageUrl(id, size, "jpg") as string;
  return { original: url, small: at(t.small), medium: at(t.medium), large: at(t.large), resized: true };
}
