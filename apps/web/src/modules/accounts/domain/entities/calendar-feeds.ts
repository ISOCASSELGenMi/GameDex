/**
 * 私人 iCal 訂閱 feed（03 §calendar_feeds、08 §私人 feed）：我方型別、token 規則與驗證。純函式、零外部依賴。
 */
import { isRecord, readText, type FieldErrors, type Validated } from "./lists";

export const FEED_TYPES = ["all", "releases", "events", "following"] as const;
export type FeedType = (typeof FEED_TYPES)[number];

/** token：256-bit 亂數，base64url＝43 字元（不含 padding）。 */
export const FEED_TOKEN_BYTES = 32;
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const FEED_DEFAULT_NAME = "My Game Calendar";
export const FEED_NAME_MAX = 100;
/** 篩選陣列的元素上限（與 06 的「單一參數最多 20 個值」一致）。 */
export const FEED_FILTER_MAX = 20;

/** 重新產生後，舊網址回傳空 ics 的天數；之後回 410 Gone（08 §Token 安全）。 */
export const FEED_REVOKED_EMPTY_DAYS = 30;
/** 建立與重新產生的 rate limit：每位使用者每小時最多這麼多次。 */
export const FEED_CREATE_LIMIT_PER_HOUR = 10;
/** lastAccessedAt 的寫入節流：距離上次寫入不到這麼久就不寫。 */
export const FEED_ACCESS_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** feed 內容的 Cache-Control（私人，不進 CDN；08 §HTTP 快取）。 */
export const FEED_CACHE_CONTROL = "private, max-age=300";

export function isFeedTokenShape(value: string): boolean {
  return FEED_TOKEN_PATTERN.test(value);
}

/** `abc….ics` → token；不是 `.ics` 結尾或 token 形狀不對 → null。 */
export function tokenFromIcsFile(file: string): string | null {
  if (!file.toLowerCase().endsWith(".ics")) return null;
  const token = file.slice(0, -4);
  return isFeedTokenShape(token) ? token : null;
}

/** 重新產生後的舊網址：30 天內回空 ics（"empty"），超過回 410（"gone"）。 */
export function revokedFeedState(revokedAt: Date, now: Date): "empty" | "gone" {
  return now.getTime() - revokedAt.getTime() <= FEED_REVOKED_EMPTY_DAYS * 86_400_000 ? "empty" : "gone";
}

export interface FeedSettings {
  name: string;
  locale: string;
  filterPlatforms: number[];
  filterRegions: number[];
  filterGenres: string[];
  filterStages: string[];
  includeReleases: boolean;
  includeEvents: boolean;
}

export type FeedPatchInput = Partial<FeedSettings>;

function readIdArray(body: Record<string, unknown>, key: string, fields: FieldErrors): number[] | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  const raw = body[key];
  if (!Array.isArray(raw)) {
    fields[key] = "invalid";
    return undefined;
  }
  if (raw.length > FEED_FILTER_MAX) {
    fields[key] = "too_many";
    return undefined;
  }
  const ids: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || v > 2_147_483_647) {
      fields[key] = "invalid";
      return undefined;
    }
    ids.push(v);
  }
  return [...new Set(ids)];
}

function readSlugArray(body: Record<string, unknown>, key: string, fields: FieldErrors, pattern: RegExp): string[] | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  const raw = body[key];
  if (!Array.isArray(raw)) {
    fields[key] = "invalid";
    return undefined;
  }
  if (raw.length > FEED_FILTER_MAX) {
    fields[key] = "too_many";
    return undefined;
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !pattern.test(v)) {
      fields[key] = "invalid";
      return undefined;
    }
    out.push(v);
  }
  return [...new Set(out)];
}

/**
 * PATCH /calendar/feeds/{id} 的 body：name、locale、filterPlatforms、filterRegions、filterGenres、filterStages、includeReleases、includeEvents，
 * 全部選填（至少一個）。`isSupportedLocale`、`isKnownStage` 由呼叫端注入（locale 清單在 kernel、階段清單在 catalog）。
 */
export function validateFeedPatch(
  body: unknown,
  deps: { isSupportedLocale(v: string): boolean; isKnownStage(v: string): boolean },
): Validated<FeedPatchInput> {
  if (!isRecord(body)) return { ok: false, fields: { body: "invalid" } };
  const fields: FieldErrors = {};
  const out: FeedPatchInput = {};
  const name = readText(body, "name", FEED_NAME_MAX, fields, { nullable: false, required: false });
  if (name !== undefined && name !== null) out.name = name;
  if (body.locale !== undefined) {
    if (typeof body.locale === "string" && deps.isSupportedLocale(body.locale)) out.locale = body.locale;
    else fields.locale = "invalid";
  }
  const platforms = readIdArray(body, "filterPlatforms", fields);
  if (platforms) out.filterPlatforms = platforms;
  const regions = readIdArray(body, "filterRegions", fields);
  if (regions) out.filterRegions = regions;
  const genres = readSlugArray(body, "filterGenres", fields, /^[a-z0-9][a-z0-9-]{0,99}$/);
  if (genres) out.filterGenres = genres;
  const stages = readSlugArray(body, "filterStages", fields, /^[a-z_]{1,32}$/);
  if (stages) {
    if (stages.every((s) => deps.isKnownStage(s))) out.filterStages = stages;
    else fields.filterStages = "invalid";
  }
  for (const key of ["includeReleases", "includeEvents"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] === "boolean") out[key] = body[key];
      else fields[key] = "invalid";
    }
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(out).length === 0) return { ok: false, fields: { body: "empty" } };
  return { ok: true, value: out };
}

/** API 回應的 feed（不含 token 的雜湊與密文）。url 解不出來（TOKEN_ENCRYPTION_KEY 換過）時為 null，要重新產生。 */
export interface CalendarFeedView {
  id: number;
  /** 完整網址（NEXT_PUBLIC_SITE_URL；沒設時用請求的 origin）。 */
  url: string | null;
  /** 同網址的 webcal:// 版本（Apple 日曆一鍵訂閱）。 */
  webcalUrl: string | null;
  name: string;
  locale: string;
  feedType: FeedType;
  filterPlatforms: number[];
  filterRegions: number[];
  filterGenres: string[];
  filterStages: string[];
  includeReleases: boolean;
  includeEvents: boolean;
  settingsVersion: number;
  createdAt: string;
  lastAccessedAt: string | null;
}
