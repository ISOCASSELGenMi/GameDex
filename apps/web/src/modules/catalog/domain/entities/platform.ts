import type { DatePrecision, IsoDate, PlatformKind } from "./enums";

/** 正規化後的日期（04 §日期正規化）；上市事件與硬體上市日共用。 */
export interface ReleaseDateSpan {
  /** 代表日期（P24）：day＝當日；month＝當月第一天；quarter/year＝期間最後一天；tbd＝NULL。 */
  releaseDate: IsoDate | null;
  /** 期間第一天；tbd＝NULL。 */
  periodStart: IsoDate | null;
  precision: DatePrecision;
}

export interface PlatformFamilyRecord {
  igdbId: number;
  name: string;
  slug: string;
}

/** 硬體上市日；同一平台同一地區可能有多筆（各版本），取最早由 Use Case 決定。 */
export interface PlatformReleaseDateRecord extends ReleaseDateSpan {
  /** regions.code（WW、US、EU、JP…）。 */
  regionCode: string;
}

/** GameDataProvider.fetchPlatforms() 的回傳；來源格式已在 Provider 轉完。 */
export interface PlatformRecord {
  igdbId: number;
  name: string;
  slug: string;
  abbreviation: string | null;
  alternativeName: string | null;
  kind: PlatformKind;
  generation: number | null;
  family: PlatformFamilyRecord | null;
  logoUrl: string | null;
  summary: string | null;
  releaseDates: PlatformReleaseDateRecord[];
}
