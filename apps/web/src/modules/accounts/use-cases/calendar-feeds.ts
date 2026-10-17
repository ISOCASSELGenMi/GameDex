/**
 * 私人 iCal 訂閱 Use Case（08 §私人 feed、§Token 安全；09 §訂閱）。
 * - token：256-bit 亂數（base64url）；資料庫存 SHA-256（查驗）＋token-cipher 加密（再次顯示，P9、D34）。
 * - 每位使用者恰好一個有效的 following feed（partial unique）；第一次需要時自動建立。
 * - 重新產生：舊列標 revoked_at；舊網址 30 天內回空 ics、之後 410。
 * - 建立／重新產生 rate limit：每位使用者每小時 FEED_CREATE_LIMIT_PER_HOUR 次（以 calendar_feeds.created_at 計，含已撤銷的列）。
 * ics 內容由 catalog 的 prepareFollowingIcalFeed 產生（唯一的 ics 產生函式）；這裡只負責「這個人追蹤了什麼」與 feed 設定。
 */
import { createHash, randomBytes } from "node:crypto";
import { createTranslator, type Locale } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import {
  RELEASE_STAGES,
  filterExistingFollowTargets,
  listRegions,
  prepareFollowingIcalFeed,
  type IcalLinkBuilder,
  type PreparedIcalFeed,
} from "@/modules/catalog";
import {
  FEED_ACCESS_TOUCH_INTERVAL_MS,
  FEED_CREATE_LIMIT_PER_HOUR,
  FEED_TOKEN_BYTES,
  revokedFeedState,
  type CalendarFeedView,
  type FeedPatchInput,
} from "../domain/entities/calendar-feeds";
import type { FieldErrors } from "../domain/entities/lists";
import { createTokenCipher, parseAccountsEnv, type TokenCipher } from "../providers/auth";
import {
  countFeedsCreatedSince,
  findActiveFollowingFeed,
  findFeedByTokenHash,
  findOwnedFeed,
  insertFollowingFeed,
  rotateFeed,
  touchFeedAccess,
  updateFeedSettings,
  type FeedRow,
} from "../repository/calendar-feeds";
import { listFollowedIds } from "../repository/follows";
import { findUserLocale } from "../repository/user-settings";

export const generateFeedToken = (): string => randomBytes(FEED_TOKEN_BYTES).toString("base64url");
export const hashFeedToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const cipher = (): TokenCipher => createTokenCipher(parseAccountsEnv().tokenKey);

const HOUR_MS = 60 * 60 * 1000;

/** feed 網址的 origin：NEXT_PUBLIC_SITE_URL 優先（UID 網域也由它決定），沒設才用請求的。 */
export function feedOrigin(requestOrigin: string): string {
  const site = parseAccountsEnv().siteUrl;
  return site ? new URL(site).origin : requestOrigin;
}

/** 預設名稱：該語系的「我的追蹤」日曆名稱（ical.calendarName.following）。 */
export const defaultFeedName = (locale: string): string => createTranslator(locale as Locale).t("ical.calendarName.following");

function toView(row: FeedRow, origin: string): CalendarFeedView {
  let url: string | null = null;
  if (row.tokenCiphertext) {
    try {
      url = `${origin}/ical/u/${cipher().decrypt(row.tokenCiphertext)}.ics`;
    } catch {
      url = null; // TOKEN_ENCRYPTION_KEY 換過：無法再顯示，使用者要重新產生
    }
  }
  return {
    id: row.id,
    url,
    webcalUrl: url ? url.replace(/^https?:/, "webcal:") : null,
    name: row.name,
    locale: row.locale,
    feedType: row.feedType,
    filterPlatforms: row.filterPlatforms,
    filterRegions: row.filterRegions,
    filterGenres: row.filterGenres,
    filterStages: row.filterStages,
    includeReleases: row.includeReleases,
    includeEvents: row.includeEvents,
    settingsVersion: row.settingsVersion,
    createdAt: row.createdAt.toISOString(),
    lastAccessedAt: row.lastAccessedAt ? row.lastAccessedAt.toISOString() : null,
  };
}

async function rateLimited(userId: number, now: Date): Promise<boolean> {
  return (await countFeedsCreatedSince(userId, new Date(now.getTime() - HOUR_MS))) >= FEED_CREATE_LIMIT_PER_HOUR;
}

export type EnsureFeedResult = { ok: true; feed: CalendarFeedView; created: boolean } | { ok: false; code: "rate_limited" };

/** 取得本人的 following feed；沒有就建立（冪等：永遠只有一個有效的）。語系預設取 users.locale，沒有則 DEFAULT_LOCALE。 */
export async function ensureFollowingFeed(userId: number, requestOrigin: string, now: Date = new Date()): Promise<EnsureFeedResult> {
  const origin = feedOrigin(requestOrigin);
  const existing = await findActiveFollowingFeed(userId);
  if (existing) return { ok: true, feed: toView(existing, origin), created: false };
  if (await rateLimited(userId, now)) return { ok: false, code: "rate_limited" };
  const config = getLocaleConfig();
  const userLocale = await findUserLocale(userId);
  const locale = userLocale && isSupportedLocale(userLocale, config) ? userLocale : config.defaultLocale;
  const token = generateFeedToken();
  const created = await insertFollowingFeed(userId, {
    tokenHash: hashFeedToken(token),
    tokenCiphertext: cipher().encrypt(token),
    name: defaultFeedName(locale),
    locale,
  });
  if (created) return { ok: true, feed: toView(created, origin), created: true };
  // 並發建立：另一個請求先建好了
  const winner = await findActiveFollowingFeed(userId);
  return winner ? { ok: true, feed: toView(winner, origin), created: false } : { ok: false, code: "rate_limited" };
}

export type PatchFeedResult =
  | { ok: true; feed: CalendarFeedView; changed: boolean }
  | { ok: false; code: "feed_not_found" }
  | { ok: false; code: "validation_failed"; fields: FieldErrors };

const sameArray = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 更新設定。名稱、語系、篩選、include* 任何一項「實際有變」就 settingsVersion + 1（ETag 隨之改變）；沒有變化不 +1。
 * 語系改變、且名稱還是舊語系的預設名稱、這次也沒指定名稱時，名稱跟著換成新語系的預設名稱。
 * 篩選的平台與地區 id 必須存在（其他維度不存在的 slug 在產生 ics 時被忽略）。
 */
export async function patchFeed(userId: number, feedId: number, patch: FeedPatchInput, requestOrigin: string): Promise<PatchFeedResult> {
  const origin = feedOrigin(requestOrigin);
  const current = await findOwnedFeed(userId, feedId);
  if (!current || current.revokedAt) return { ok: false, code: "feed_not_found" };

  const fields: FieldErrors = {};
  if (patch.filterPlatforms && patch.filterPlatforms.length > 0) {
    const ok = await filterExistingFollowTargets("platform", patch.filterPlatforms);
    if (patch.filterPlatforms.some((id) => !ok.has(id))) fields.filterPlatforms = "invalid";
  }
  if (patch.filterRegions && patch.filterRegions.length > 0) {
    const known = new Set((await listRegions()).map((r) => r.id));
    if (patch.filterRegions.some((id) => !known.has(id))) fields.filterRegions = "invalid";
  }
  if (Object.keys(fields).length > 0) return { ok: false, code: "validation_failed", fields };

  const next: FeedPatchInput = { ...patch };
  if (patch.locale && patch.locale !== current.locale && patch.name === undefined && current.name === defaultFeedName(current.locale)) {
    next.name = defaultFeedName(patch.locale);
  }
  const changed =
    (next.name !== undefined && next.name !== current.name) ||
    (next.locale !== undefined && next.locale !== current.locale) ||
    (next.filterPlatforms !== undefined && !sameArray([...next.filterPlatforms].sort((a, b) => a - b), [...current.filterPlatforms].sort((a, b) => a - b))) ||
    (next.filterRegions !== undefined && !sameArray([...next.filterRegions].sort((a, b) => a - b), [...current.filterRegions].sort((a, b) => a - b))) ||
    (next.filterGenres !== undefined && !sameArray([...next.filterGenres].sort(), [...current.filterGenres].sort())) ||
    (next.filterStages !== undefined && !sameArray([...next.filterStages].sort(), [...current.filterStages].sort())) ||
    (next.includeReleases !== undefined && next.includeReleases !== current.includeReleases) ||
    (next.includeEvents !== undefined && next.includeEvents !== current.includeEvents);
  if (!changed) return { ok: true, feed: toView(current, origin), changed: false };
  const row = await updateFeedSettings(userId, feedId, next, true);
  return row ? { ok: true, feed: toView(row, origin), changed: true } : { ok: false, code: "feed_not_found" };
}

export type RotateFeedResult = { ok: true; feed: CalendarFeedView } | { ok: false; code: "feed_not_found" | "rate_limited" };

/** 重新產生網址（外洩補救）：舊網址 30 天內回空 ics、之後 410。 */
export async function rotateFollowingFeed(userId: number, feedId: number, requestOrigin: string, now: Date = new Date()): Promise<RotateFeedResult> {
  const origin = feedOrigin(requestOrigin);
  const current = await findOwnedFeed(userId, feedId);
  if (!current || current.revokedAt) return { ok: false, code: "feed_not_found" };
  if (await rateLimited(userId, now)) return { ok: false, code: "rate_limited" };
  const token = generateFeedToken();
  const row = await rotateFeed(userId, feedId, { tokenHash: hashFeedToken(token), tokenCiphertext: cipher().encrypt(token) }, now);
  return row ? { ok: true, feed: toView(row, origin) } : { ok: false, code: "feed_not_found" };
}

// ── /ical/u/{token}.ics ─────────────────────────────────────────────────

export type PrivateFeedLookup =
  | { state: "not_found" }
  | { state: "gone" }
  | { state: "ready"; feed: FeedRow; revoked: boolean };

/** 用 token 找 feed：不存在／帳號已刪除（cascade）→ not_found；撤銷超過 30 天 → gone；其餘 ready（revoked＝撤銷 30 天內，內容為空）。 */
export async function lookupPrivateFeed(token: string, now: Date = new Date()): Promise<PrivateFeedLookup> {
  const row = await findFeedByTokenHash(hashFeedToken(token));
  if (!row) return { state: "not_found" };
  if (row.revokedAt) return revokedFeedState(row.revokedAt, now) === "gone" ? { state: "gone" } : { state: "ready", feed: row, revoked: true };
  return { state: "ready", feed: row, revoked: false };
}

/** lastAccessedAt（節流：1 小時內不重寫）。失敗不影響回應。 */
export async function recordFeedAccess(feedId: number, now: Date = new Date()): Promise<void> {
  try {
    await touchFeedAccess(feedId, now, FEED_ACCESS_TOUCH_INTERVAL_MS);
  } catch {
    // 只是統計用的欄位
  }
}

/** 準備 feed 的 ics（ETag 先算、內容延後產生）。撤銷中的 feed 沒有任何追蹤範圍 → 空 ics，完全不查詢 catalog。 */
export async function preparePrivateFeed(
  feed: FeedRow,
  opts: { revoked: boolean; links: IcalLinkBuilder; today?: string },
): Promise<PreparedIcalFeed> {
  const config = getLocaleConfig();
  const locale = isSupportedLocale(feed.locale, config) ? feed.locale : config.defaultLocale;
  const followed = opts.revoked
    ? { game: [], event: [], platform: [], franchise: [], company: [] }
    : await listFollowedIds(feed.userId);
  let regionCodes: string[] = [];
  if (!opts.revoked && feed.filterRegions.length > 0) {
    const byId = new Map((await listRegions()).map((r) => [r.id, r.code]));
    regionCodes = feed.filterRegions.flatMap((id) => (byId.has(id) ? [byId.get(id) as string] : []));
  }
  return prepareFollowingIcalFeed({
    locale,
    calendarName: feed.name,
    links: opts.links,
    follows: {
      gameIds: followed.game,
      eventIds: followed.event,
      platformIds: followed.platform,
      franchiseIds: followed.franchise,
      companyIds: followed.company,
    },
    filters: {
      platformIds: feed.filterPlatforms,
      regionCodes,
      genreSlugs: feed.filterGenres,
      stages: feed.filterStages.filter((s) => (RELEASE_STAGES as readonly string[]).includes(s)),
    },
    includeReleases: feed.includeReleases,
    includeEvents: feed.includeEvents,
    settingsVersion: feed.settingsVersion,
    ...(opts.today ? { today: opts.today } : {}),
  });
}
