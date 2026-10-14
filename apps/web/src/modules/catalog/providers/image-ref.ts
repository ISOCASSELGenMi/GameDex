/**
 * 已存圖片網址 → ImageRef（Domain 的 ImageResolver 實作）。Use Case 把它交給 Repository 套用，
 * Repository 本身不知道任何來源的網址格式（02 分層：Repository 不 import Provider）。
 *
 * 認得的來源（目前只有 IGDB）換成各尺寸網址；認不得但是 http(s) 的網址原樣使用（不靜默變成沒封面）；
 * 其他（空值、非 http(s)）回 null。
 */
import type { ImageKind, ImageRef, ImageResolver } from "../domain/entities";
import { igdbImageRef } from "./igdb/images";

export const resolveImageRef: ImageResolver = (storedUrl: string | null | undefined, kind: ImageKind): ImageRef | null => {
  const url = storedUrl?.trim();
  if (!url) return null;
  const known = igdbImageRef(url, kind);
  if (known) return known;
  if (!/^https?:\/\//i.test(url)) return null;
  return { original: url, small: url, medium: url, large: url, resized: false };
};
