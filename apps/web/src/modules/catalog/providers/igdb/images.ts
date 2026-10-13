/**
 * IGDB 圖片 CDN 網址 → ImageRef（原則二：IGDB 網址格式與尺寸 token 只存在 Provider 層）。
 * 同步時存進資料庫的是 igdbImageUrl() 產生的完整網址（封面 t_cover_big、截圖 t_screenshot_big，jpg；
 * 平台／公司／活動 logo t_logo_med，png）；讀取時由這裡換成各尺寸。
 */
import type { ImageKind, ImageRef } from "../../domain/entities";
import { igdbImageUrl } from "./mappings";

const IGDB_IMAGE_RE =
  /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_[a-z0-9_]+\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp|gif)$/;

/**
 * 各用途的尺寸 token（06 §封面圖）與副檔名。logo 只用「內縮（Fit）」的尺寸：t_thumb／t_micro 會裁成正方形，
 * 寬 logo 會被切掉，所以 small 與 medium 都用 t_logo_med（284×160），large 用 t_720p；png 保留透明背景。
 */
const SIZE_TOKENS: Readonly<Record<ImageKind, { small: string; medium: string; large: string; ext: "jpg" | "png" }>> = {
  cover: { small: "t_cover_small", medium: "t_cover_big", large: "t_1080p", ext: "jpg" },
  screenshot: { small: "t_screenshot_med", medium: "t_screenshot_big", large: "t_1080p", ext: "jpg" },
  logo: { small: "t_logo_med", medium: "t_logo_med", large: "t_720p", ext: "png" },
};

/** 從 IGDB 圖片網址取出 image id；不是 IGDB 圖片網址回 null。 */
export function parseIgdbImageId(url: string): string | null {
  return IGDB_IMAGE_RE.exec(url)?.[1] ?? null;
}

/** IGDB 圖片網址 → ImageRef（各尺寸換 token；封面／截圖 jpg、logo png）；不是 IGDB 圖片網址回 null（由呼叫端決定 fallback）。 */
export function igdbImageRef(url: string, kind: ImageKind): ImageRef | null {
  const id = parseIgdbImageId(url);
  if (!id) return null;
  const t = SIZE_TOKENS[kind];
  const at = (size: string) => igdbImageUrl(id, size, t.ext) as string;
  return { original: url, small: at(t.small), medium: at(t.medium), large: at(t.large), resized: true };
}
