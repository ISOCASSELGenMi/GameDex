/**
 * IGDB 數字 enum → 我方名稱（原則二：外部格式只存在 Provider 層）。
 * 未知值不讓同步失敗：回傳預設值並由呼叫端記警告。
 */
import type { PlatformKind } from "../../domain/entities";

/** `release_dates.release_region`／`platform_version_release_dates.release_region`（release_date_regions 字典，04 §地區對照）。 */
const IGDB_RELEASE_REGION_TO_CODE: Readonly<Record<number, string>> = {
  1: "EU", 2: "US", 3: "AU", 4: "AU", // 4 紐西蘭併入 AU
  5: "JP", 6: "CN", 7: "ASIA", 8: "WW", 9: "KR", 10: "BR",
};

/** 沒對到 → WW。⚠️ 不可用於 game_localizations.region（另一個 id 空間）。 */
export function mapReleaseRegion(id: number | null | undefined): string {
  return (id != null && IGDB_RELEASE_REGION_TO_CODE[id]) || "WW";
}

/**
 * `platforms.platform_type`（platform_types 字典，2026-10-12 實測 6 筆）。
 * 3 Platform（Web browser、Stadia、OnLive…）→ other；4 Operating_system 依平台 id 決定（見下）。
 */
const PLATFORM_TYPE_TO_KIND: Readonly<Record<number, PlatformKind>> = {
  1: "console", // Console
  2: "arcade", // Arcade
  3: "other", // Platform
  5: "handheld", // Portable_console
  6: "pc", // Computer
};

/**
 * 我方規則（D21）：以 IGDB 平台 id 覆寫，優先於 platform_type。
 * - hybrid：Switch 系列
 * - mobile（P35：不收）：IGDB 把手機 OS 與桌面 OS 都歸 Operating_system，只能逐一列出
 * - pc：桌面 OS
 * 清單依 2026-10-12 的 /platforms 全表（220 筆）整理；新平台出現時 platform_type=4 會落到 other 並記警告。
 */
const PLATFORM_KIND_OVERRIDES: Readonly<Record<number, PlatformKind>> = {
  130: "hybrid", // Nintendo Switch
  508: "hybrid", // Nintendo Switch 2
  34: "mobile", // Android
  39: "mobile", // iOS
  55: "mobile", // Legacy Mobile Device
  73: "mobile", // BlackBerry OS
  74: "mobile", // Windows Phone
  405: "mobile", // Windows Mobile
  417: "mobile", // Palm OS
  3: "pc", // Linux
  6: "pc", // PC (Microsoft Windows)
  13: "pc", // DOS
  14: "pc", // Mac
  472: "other", // visionOS（頭戴裝置，不是桌面也不是手機）
};

export interface PlatformKindResult {
  kind: PlatformKind;
  /** true = platform_type 未知或是未列入覆寫表的 Operating_system，呼叫端應記警告。 */
  unmapped: boolean;
}

export function mapPlatformKind(igdbPlatformId: number, platformType: number | null | undefined): PlatformKindResult {
  const override = PLATFORM_KIND_OVERRIDES[igdbPlatformId];
  if (override) return { kind: override, unmapped: false };
  const kind = platformType != null ? PLATFORM_TYPE_TO_KIND[platformType] : undefined;
  if (kind) return { kind, unmapped: false };
  return { kind: "other", unmapped: true };
}

const IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";

/** 圖片 URL；前端依 viewport 換尺寸 token（06 §封面圖）。logo 用 png（透明背景），封面與截圖用 jpg。 */
export function igdbImageUrl(
  imageId: string | null | undefined,
  size = "t_logo_med",
  ext: "png" | "jpg" = "png",
): string | null {
  return imageId ? `${IMAGE_BASE}/${size}/${imageId}.${ext}` : null;
}
