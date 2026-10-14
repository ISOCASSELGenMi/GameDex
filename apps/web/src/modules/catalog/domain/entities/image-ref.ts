// 圖片參照（06 §封面圖：依 viewport 選尺寸）。Domain 型別，零外部格式知識：
// 來源 CDN 的網址格式與尺寸 token 換算只在 Provider 層（providers/image-ref.ts），由 Use Case 交給 Repository 套用。

/** 圖片用途；Provider 依用途決定各尺寸對應的實際網址。logo＝平台、公司、活動的 logo（3b）。 */
export type ImageKind = "cover" | "screenshot" | "logo";

/**
 * 已解析好各尺寸網址的圖片。UI 直接用這裡的網址，不自行組網址。
 * - cover：small ≈ 列表縮圖（90×128）、medium ≈ 詳情封面（264×374）、large ≈ 高解析。
 * - screenshot：small ≈ 569×320、medium ≈ 889×500、large ≈ 1080p。
 * - logo：small＝medium ≈ 284×160 內縮（不裁切）、large ≈ 1280×720 內縮；透明背景（png）。
 */
export interface ImageRef {
  /** 資料庫存的原始網址（原樣）。 */
  original: string;
  small: string;
  medium: string;
  large: string;
  /**
   * true＝各尺寸是來源 CDN 實際縮放過的網址（該來源已列入 next.config 的 images.remotePatterns，可經最佳化器）；
   * false＝未知來源，各尺寸都等於 original（原樣使用，UI 不經最佳化器）。
   */
  resized: boolean;
}

/** 已存網址 → ImageRef；沒有網址或網址不可用（非 http(s)）回 null。由 Provider 實作、Use Case 注入 Repository。 */
export type ImageResolver = (storedUrl: string | null | undefined, kind: ImageKind) => ImageRef | null;
