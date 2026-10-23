/**
 * 帳號本人的設定、匯出與刪除（第 7 波；07 §帳號、09 §隱私、匯出、刪除）：我方型別、常數與驗證。純函式、零外部依賴。
 */
import { isRecord, readText, type FieldErrors, type ListVisibility, type Validated } from "./lists";
import { LIST_VISIBILITIES, REVIEW_VISIBILITIES } from "./providers";
import type { UnlockView } from "./unlocks";
import type { ReviewVisibility } from "./play-records";

export const DISPLAY_NAME_MAX = 100;
/** preferredPlatformIds 的上限（與私人 feed 的平台篩選一致）。 */
export const PREFERRED_PLATFORMS_MAX = 20;
export const TIMEZONE_MAX = 64;

/**
 * 刪除帳號的重新驗證（09）：
 * - 有密碼（credential 列）：body 帶 `{ password }`，驗證通過即可。
 * - 沒有密碼（只有 Steam／社群登入）：session 必須是「新的」＝建立時間在這個秒數之內，否則回 401 reauth_required，
 *   畫面引導重新登入後再刪。10 分鐘：夠完成一次重新登入與閱讀確認文字，又不會讓被偷走的舊 session 能刪帳號。
 */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

/** 每使用者每小時次數上限（單機部署、記憶體計數；重啟歸零）。 */
export const ACCOUNT_DELETE_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 } as const;
export const ACCOUNT_EXPORT_RATE_LIMIT = { max: 12, windowMs: 60 * 60 * 1000 } as const;
export const ACCOUNT_PREFERENCES_RATE_LIMIT = { max: 120, windowMs: 60 * 60 * 1000 } as const;

export interface AccountPreferences {
  displayName: string;
  /** null＝沒設定（跟隨網站語言偵測）。 */
  locale: string | null;
  timezone: string | null;
  /** null＝沒設定（DEFAULT_REGION_PREF）。 */
  preferredRegion: string | null;
  /** null＝沒設定（網站預設來源）；空陣列＝什麼來源都不顯示（selectRatings 語意）。 */
  scoreProviders: string[] | null;
  preferredPlatformIds: number[];
  defaultListVisibility: ListVisibility;
  defaultReviewVisibility: ReviewVisibility;
}

export type AccountPreferencesPatch = Partial<AccountPreferences>;

/** IANA 時區名稱（Area/Location）驗證：Intl 認得，且不是 `+08:00` 這類位移寫法。 */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > TIMEZONE_MAX) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface PreferencesValidationDeps {
  isSupportedLocale(v: string): boolean;
  /** 已知的地區代碼（大小寫不拘；回傳正規化後的大寫代碼，未知回 null）。 */
  normalizeRegion(v: string): string | null;
  isKnownScoreProvider(v: string): boolean;
}

/**
 * PATCH /api/v1/account/preferences 的 body：任何子集，至少一個欄位。可清除的欄位（locale、timezone、preferredRegion、scoreProviders）傳 null。
 * 平台 id 是否存在於資料庫由 use case 檢查（需要 catalog）。
 */
export function validatePreferencesPatch(body: unknown, deps: PreferencesValidationDeps): Validated<AccountPreferencesPatch> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  const out: AccountPreferencesPatch = {};

  const name = readText(body, "displayName", DISPLAY_NAME_MAX, fields, { nullable: false, required: false });
  if (typeof name === "string") out.displayName = name;

  if (body.locale !== undefined) {
    if (body.locale === null) out.locale = null;
    else if (typeof body.locale === "string" && deps.isSupportedLocale(body.locale)) out.locale = body.locale;
    else fields.locale = "invalid";
  }
  if (body.timezone !== undefined) {
    if (body.timezone === null) out.timezone = null;
    else if (typeof body.timezone === "string" && isValidTimeZone(body.timezone)) out.timezone = body.timezone;
    else fields.timezone = "invalid";
  }
  if (body.preferredRegion !== undefined) {
    if (body.preferredRegion === null) out.preferredRegion = null;
    else {
      const code = typeof body.preferredRegion === "string" ? deps.normalizeRegion(body.preferredRegion) : null;
      if (code) out.preferredRegion = code;
      else fields.preferredRegion = "invalid";
    }
  }
  if (body.scoreProviders !== undefined) {
    if (body.scoreProviders === null) out.scoreProviders = null;
    else if (!Array.isArray(body.scoreProviders)) fields.scoreProviders = "invalid";
    else if (body.scoreProviders.length > 10) fields.scoreProviders = "too_many";
    else if (body.scoreProviders.every((v) => typeof v === "string" && deps.isKnownScoreProvider(v))) out.scoreProviders = [...new Set(body.scoreProviders as string[])];
    else fields.scoreProviders = "invalid";
  }
  if (body.preferredPlatformIds !== undefined) {
    const raw = body.preferredPlatformIds;
    if (!Array.isArray(raw)) fields.preferredPlatformIds = "invalid";
    else if (raw.length > PREFERRED_PLATFORMS_MAX) fields.preferredPlatformIds = "too_many";
    else if (raw.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647)) out.preferredPlatformIds = [...new Set(raw as number[])];
    else fields.preferredPlatformIds = "invalid";
  }
  if (body.defaultListVisibility !== undefined) {
    if (typeof body.defaultListVisibility === "string" && (LIST_VISIBILITIES as readonly string[]).includes(body.defaultListVisibility)) out.defaultListVisibility = body.defaultListVisibility as ListVisibility;
    else fields.defaultListVisibility = "invalid";
  }
  if (body.defaultReviewVisibility !== undefined) {
    if (typeof body.defaultReviewVisibility === "string" && (REVIEW_VISIBILITIES as readonly string[]).includes(body.defaultReviewVisibility)) out.defaultReviewVisibility = body.defaultReviewVisibility as ReviewVisibility;
    else fields.defaultReviewVisibility = "invalid";
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(out).length === 0) return { ok: false, fields: { body: "empty" } };
  return { ok: true, value: out };
}

/** DELETE /api/v1/account 的 body：`{ password? }`（沒有 body 視為沒帶密碼）。 */
export function parseDeleteBody(body: unknown): Validated<{ password: string | null }> {
  if (body === undefined || body === null) return { ok: true, value: { password: null } };
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  if (body.password === undefined || body.password === null) return { ok: true, value: { password: null } };
  if (typeof body.password !== "string" || body.password.length > 1024) return { ok: false, fields: { password: "invalid" } };
  return { ok: true, value: { password: body.password } };
}

// ── 匯出 ──────────────────────────────────────────────────────────────────────

export const EXPORT_FORMATS = ["json", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** CSV 分段下載（不用壓縮檔套件：每段一個檔）。 */
export const EXPORT_CSV_PARTS = ["profile", "lists", "list_games", "plays", "follows", "owned_games"] as const;
export type ExportCsvPart = (typeof EXPORT_CSV_PARTS)[number];

export function isExportCsvPart(value: string): value is ExportCsvPart {
  return (EXPORT_CSV_PARTS as readonly string[]).includes(value);
}

export const EXPORT_VERSION = 1;

const CSV_FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * 一個 CSV 儲存格（RFC 4180）。字串開頭是 `=`、`+`、`-`、`@`、Tab、CR 時前面加單引號（避免試算表把使用者輸入當成公式執行）；
 * 含 `"`、`,`、換行的欄位用雙引號包起來。數字、布林、日期、null 不受公式防護影響（它們不是使用者輸入的文字）。
 */
export function csvCell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "string") text = value !== "" && CSV_FORMULA_LEADERS.has(value[0]!) ? `'${value}` : value;
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 表頭＋列 → CSV 文字（CRLF 換行；開頭加 UTF-8 BOM 讓 Excel 正確辨識 UTF-8）。 */
export function toCsv<K extends string>(columns: readonly K[], rows: ReadonlyArray<Readonly<Record<K, string | number | boolean | Date | null | undefined>>>): string {
  const lines = [columns.map((c) => csvCell(c)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** 匯出內容（JSON 的整體形狀；CSV 各段由同一份資料展開，不另算）。不含密碼雜湊、任何 token、私人行事曆的 feed token。 */
export interface AccountExport {
  exportVersion: number;
  exportedAt: string;
  profile: {
    id: number;
    displayName: string;
    /** 儲存的信箱。沒有信箱的帳號（Steam 等）是系統產生的 placeholder，`emailIsPlaceholder` 為 true，不是真實信箱。 */
    email: string;
    emailIsPlaceholder: boolean;
    emailVerified: boolean;
    handle: string | null;
    avatarUrl: string | null;
    role: string;
    createdAt: string;
  };
  preferences: Omit<AccountPreferences, "displayName">;
  connections: Array<{ provider: string; connectedAt: string }>;
  lists: Array<{
    id: number;
    name: string;
    description: string | null;
    visibility: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    games: Array<{ gameId: number; gameSlug: string | null; gameName: string | null; position: number; note: string | null; addedAt: string }>;
  }>;
  playRecords: Array<{
    id: number;
    gameId: number;
    gameSlug: string | null;
    gameName: string | null;
    platformId: number | null;
    status: string;
    startedOn: string | null;
    finishedOn: string | null;
    playMinutes: number | null;
    /** 0.5~10；未評分為 null。 */
    rating: number | null;
    review: string | null;
    reviewHasSpoilers: boolean;
    reviewVisibility: string;
    privateNote: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  follows: Array<{ targetType: string; targetId: number; targetSlug: string | null; targetName: string | null; followedAt: string }>;
  ownedGames: Array<{
    provider: string;
    externalGameId: string;
    externalTitle: string;
    status: string;
    matchedGameId: number | null;
    matchedGameSlug: string | null;
    matchedGameName: string | null;
    matchConfidencePct: number | null;
    matchMethod: string;
    importedAt: string;
  }>;
  /** 私人行事曆設定（沒有建立過為 null）。**不含**訂閱網址的 token。 */
  privateCalendar: {
    name: string;
    locale: string;
    feedType: string;
    includeReleases: boolean;
    includeEvents: boolean;
    filterPlatforms: number[];
    filterRegions: number[];
    filterGenres: string[];
    filterStages: string[];
    createdAt: string;
    lastAccessedAt: string | null;
  } | null;
  /** 彩蛋解鎖紀錄（主題、收集物、成就；Z3B）。 */
  unlocks: UnlockView[];
}
