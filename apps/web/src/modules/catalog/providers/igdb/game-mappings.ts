/**
 * IGDB 遊戲相關的數字 enum → 我方名稱（04 §上市階段對照、§遊戲層級狀態、§遊戲類型；03 §語言支援）。
 * 字典值於 2026-10-12 以 game_types／game_statuses／release_date_statuses／languages／regions 端點核對。
 * 未知值不讓同步失敗：回傳預設值，unmapped=true 由呼叫端記警告。
 */
import type { GameStatus, GameType, LanguageSupportType, ReleaseStage } from "../../domain/entities";

interface Mapped<T> {
  value: T;
  unmapped: boolean;
}

const GAME_TYPE: Readonly<Record<number, GameType>> = {
  0: "main_game",
  1: "dlc_addon",
  2: "expansion",
  3: "bundle",
  4: "standalone_expansion",
  5: "mod",
  6: "episode",
  7: "season",
  8: "remake",
  9: "remaster",
  10: "expanded_game",
  11: "port",
  12: "fork",
  13: "pack",
  14: "update",
};

/** 空值視為 main_game（🧪 全庫無空值）；未知 id → other。 */
export function mapGameType(id: number | null | undefined): Mapped<GameType> {
  if (id == null) return { value: "main_game", unmapped: false };
  const value = GAME_TYPE[id];
  return value ? { value, unmapped: false } : { value: "other", unmapped: true };
}

const GAME_STATUS: Readonly<Record<number, GameStatus>> = {
  0: "released",
  2: "alpha",
  3: "beta",
  4: "early_access",
  5: "offline",
  6: "cancelled",
  7: "rumored",
  8: "delisted",
};

/** 空值 → NULL（一般狀態）；未知 id → NULL＋警告。 */
export function mapGameStatus(id: number | null | undefined): Mapped<GameStatus | null> {
  if (id == null) return { value: null, unmapped: false };
  const value = GAME_STATUS[id];
  return value ? { value, unmapped: false } : { value: null, unmapped: true };
}

const RELEASE_STAGE: Readonly<Record<number, ReleaseStage>> = {
  1: "alpha",
  2: "beta",
  3: "early_access",
  4: "other", // Offline
  6: "full",
  34: "other", // Advanced Access
  35: "other", // Digital Compatibility Release
  36: "other", // Next-Gen Optimization Patch Release
};
const IGDB_RELEASE_CANCELLED = 5;

/**
 * `release_dates.status` → 上市階段（P22）：5 Cancelled → unspecified＋cancelled；空值與未知值 → unspecified（不預設 full）。
 */
export function mapReleaseStage(status: number | null | undefined): Mapped<{ stage: ReleaseStage; cancelled: boolean }> {
  if (status == null) return { value: { stage: "unspecified", cancelled: false }, unmapped: false };
  if (status === IGDB_RELEASE_CANCELLED) return { value: { stage: "unspecified", cancelled: true }, unmapped: false };
  const stage = RELEASE_STAGE[status];
  return stage
    ? { value: { stage, cancelled: false }, unmapped: false }
    : { value: { stage: "unspecified", cancelled: false }, unmapped: true };
}

const LANGUAGE_SUPPORT_TYPE: Readonly<Record<number, LanguageSupportType>> = {
  1: "audio",
  2: "subtitles",
  3: "interface",
};

/** 未知 → null（略過該筆）。 */
export function mapLanguageSupportType(id: number | null | undefined): LanguageSupportType | null {
  return (id != null && LANGUAGE_SUPPORT_TYPE[id]) || null;
}

/** IGDB 的 languages.locale 已是 BCP-47；中文改用書寫系統標記（03 §語言支援）。 */
const LANGUAGE_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  "zh-TW": "zh-Hant",
  "zh-CN": "zh-Hans",
};

/** 對不上（沒有 locale）→ 用英文名 slug，不報錯。 */
export function mapLanguageCode(locale: string | null | undefined, name: string | null | undefined, igdbId: number): string {
  const l = locale?.trim();
  if (l) return LANGUAGE_CODE_OVERRIDES[l] ?? l;
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `language-${igdbId}`;
}

/**
 * `game_localizations.region`（regions 字典，⚠️ 與 release_region 不同 id 空間）→ 我方語系碼。
 * 3 Japan → ja、2 Korea → ko；4 Europe 不是語系，略過（06 §遊戲名稱解析鏈）。
 */
const LOCALIZATION_REGION_TO_LOCALE: Readonly<Record<number, string | null>> = {
  2: "ko",
  3: "ja",
  4: null,
};

export function mapLocalizationRegion(region: number | null | undefined): Mapped<string | null> {
  if (region == null) return { value: null, unmapped: false };
  if (region in LOCALIZATION_REGION_TO_LOCALE) return { value: LOCALIZATION_REGION_TO_LOCALE[region], unmapped: false };
  return { value: null, unmapped: true };
}
