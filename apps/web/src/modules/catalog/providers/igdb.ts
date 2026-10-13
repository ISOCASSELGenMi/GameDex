/**
 * IGDB Provider（04）：Twitch OAuth token 快取、節流（4/s＋並發 8）、Apicalypse 查詢、轉 Domain 型別。
 * 只在伺服器端使用（IGDB 不開 CORS，瀏覽器呼叫也會洩漏 Client Secret）。直接用 fetch，不引入 igdb-api-node。
 */
import { ConfigError, getCoreEnv } from "@/kernel/config/env";
import type {
  DictionaryDrift,
  EventRecord,
  ExternalHypeRecord,
  ExternalHypeSource,
  ExternalHypeVersion,
  FetchEventsQuery,
  FetchGamesQuery,
  FranchiseRecord,
  GameCompanyRecord,
  GameCompanyRole,
  GameLanguageSupportRecord,
  GameLocalizationRecord,
  GameRecord,
  GameReleaseDateRecord,
  PlatformFamilyRecord,
  PlatformRecord,
  PlatformVersionRecord,
  TaxonomyRecord,
} from "../domain/entities";
import type { GameDataProvider } from "./game-data-provider.interface";
import { normalizeIgdbDate } from "./igdb/dates";
import {
  gameTypeIds,
  mapGameStatus,
  mapGameType,
  mapLanguageCode,
  mapLanguageSupportType,
  mapLocalizationRegion,
  mapReleaseStage,
} from "./igdb/game-mappings";
import {
  buildGameLinks,
  findNewDictionaryIds,
  KNOWN_EXTERNAL_GAME_SOURCE_IDS,
  KNOWN_WEBSITE_TYPE_IDS,
  steamAppIdOf,
  type RawExternalGame,
  type RawWebsite,
} from "./igdb/link-map";
import { igdbImageUrl, mapPlatformKind, mapReleaseRegion } from "./igdb/mappings";
import { fetchIgdbHypeRecords, fetchIgdbHypeVersion } from "./igdb/popularity";
import { RequestLimiter, TokenBucket, realSleep, type Sleep } from "./igdb/throttle";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API_BASE = "https://api.igdb.com/v4";
/** IGDB 單次查詢上限。 */
export const IGDB_PAGE_SIZE = 500;
/** 04 §認證與節流：每秒 4 次、同時最多 8 個未完成請求（額度綁憑證、全應用共用）。 */
export const IGDB_MAX_REQ_PER_SEC = 4;
export const IGDB_MAX_CONCURRENT = 8;

type FetchLike = typeof fetch;
type Warn = (message: string, extra?: Record<string, unknown>) => void;
const defaultWarn: Warn = (message, extra) => console.warn(`[igdb] ${message}`, extra ?? "");

export class IgdbError extends Error {
  readonly status?: number;
  readonly endpoint: string;

  constructor(message: string, opts: { endpoint: string; status?: number; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = "IgdbError";
    this.endpoint = opts.endpoint;
    this.status = opts.status;
  }
}

// ── token 快取 ─────────────────────────────────────────────────────────────

/**
 * Client Credentials token，有效期內快取；同時多個請求只會取一次。
 * Secret 放在 POST body（不放 URL），錯誤訊息不含任何憑證。
 */
export class TwitchTokenCache {
  private token?: { value: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    /** 提早這麼多秒視為過期，避免請求途中失效。 */
    private readonly marginSec = 300,
  ) {}

  async get(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** 收到 401 時呼叫；只清掉同一個 token，避免把別的請求剛換到的新 token 清掉。 */
  invalidate(value: string): void {
    if (this.token?.value === value) this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });
    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_URL, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new IgdbError(`取得 Twitch token 失敗：${errorMessage(err)}`, { endpoint: "oauth2/token", cause: err });
    }
    const text = await res.text();
    if (!res.ok) {
      throw new IgdbError(`取得 Twitch token 失敗：HTTP ${res.status} ${text.slice(0, 200)}`, {
        endpoint: "oauth2/token",
        status: res.status,
      });
    }
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw new IgdbError("Twitch token 回應格式不符", { endpoint: "oauth2/token", status: res.status });
    }
    const ttlSec = Math.max(0, json.expires_in - this.marginSec);
    this.token = { value: json.access_token, expiresAt: this.now() + ttlSec * 1000 };
    return json.access_token;
  }
}

// ── 查詢 client ────────────────────────────────────────────────────────────

export interface IgdbClientOptions {
  clientId: string;
  tokens: TwitchTokenCache;
  limiter: RequestLimiter;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  /** 單一請求逾時（含讀取 body）；逾時會釋放並發名額。 */
  timeoutMs?: number;
  /** 429、5xx、網路錯誤的重試次數。 */
  maxRetries?: number;
}

export class IgdbClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly opts: IgdbClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** POST /v4/{endpoint}，body 為 Apicalypse 查詢。每次嘗試（含重試）都經過節流。 */
  async query<T>(endpoint: string, body: string): Promise<T[]> {
    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.opts.tokens.get();
      let res: { status: number; text: string; retryAfter: string | null };
      try {
        res = await this.opts.limiter.run(async () => {
          const r = await this.fetchImpl(`${API_BASE}/${endpoint}`, {
            method: "POST",
            headers: { "Client-ID": this.opts.clientId, Authorization: `Bearer ${token}`, Accept: "application/json" },
            body,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          // body 讀完才算請求結束（並發名額涵蓋整個請求）
          return { status: r.status, text: await r.text(), retryAfter: r.headers.get("retry-after") };
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new IgdbError(`IGDB ${endpoint} 請求失敗：${errorMessage(err)}`, { endpoint, cause: err });
      }

      if (res.status === 401 && !authRetried) {
        this.opts.tokens.invalidate(token);
        authRetried = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const ra = Number(res.retryAfter);
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt));
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new IgdbError(`IGDB ${endpoint} 回應 HTTP ${res.status}：${res.text.slice(0, 500)}`, {
          endpoint,
          status: res.status,
        });
      }
      try {
        return JSON.parse(res.text) as T[];
      } catch (err) {
        throw new IgdbError(`IGDB ${endpoint} 回應不是 JSON：${res.text.slice(0, 200)}`, { endpoint, cause: err });
      }
    }
  }

  /**
   * 以 id 游標分頁抓完整張表（`where id > cursor; sort id asc; limit 500`）。
   * 只適合小表（平台、字典）；大量資料用回填（有 cursor 續傳）。
   */
  async queryAll<T extends { id: number }>(endpoint: string, fields: string, where?: string): Promise<T[]> {
    const all: T[] = [];
    let cursor = 0;
    for (;;) {
      const cond = where ? `id > ${cursor} & (${where})` : `id > ${cursor}`;
      const page = await this.query<T>(endpoint, `fields ${fields}; where ${cond}; sort id asc; limit ${IGDB_PAGE_SIZE};`);
      all.push(...page);
      if (page.length < IGDB_PAGE_SIZE) return all;
      cursor = page[page.length - 1].id;
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// ── 原始格式 → Domain ─────────────────────────────────────────────────────

interface IgdbPlatform {
  id: number;
  name?: string;
  slug?: string;
  abbreviation?: string;
  alternative_name?: string;
  platform_type?: number;
  generation?: number;
  summary?: string;
  platform_logo?: { image_id?: string };
  platform_family?: { id: number; name?: string; slug?: string };
  versions?: Array<{
    platform_version_release_dates?: Array<{ date?: number; date_format?: number; release_region?: number }>;
  }>;
}

const PLATFORM_FIELDS = [
  "name", "slug", "abbreviation", "alternative_name", "platform_type", "generation", "summary",
  "platform_logo.image_id", "platform_family.name", "platform_family.slug",
  "versions.platform_version_release_dates.date",
  "versions.platform_version_release_dates.date_format",
  "versions.platform_version_release_dates.release_region",
].join(",");

const blankToNull = (s: string | null | undefined): string | null => (s && s.trim() !== "" ? s : null);

export function toPlatformRecord(p: IgdbPlatform, warn: Warn = defaultWarn): PlatformRecord {
  const { kind, unmapped } = mapPlatformKind(p.id, p.platform_type);
  if (unmapped) warn("平台分類未對照，暫歸 other", { igdbId: p.id, name: p.name, platformType: p.platform_type });

  const family: PlatformFamilyRecord | null =
    p.platform_family?.id != null
      ? {
          igdbId: p.platform_family.id,
          name: p.platform_family.name ?? `Family ${p.platform_family.id}`,
          slug: p.platform_family.slug ?? `family-${p.platform_family.id}`,
        }
      : null;

  const versions: PlatformVersionRecord[] = (p.versions ?? []).map((v) => ({
    releaseDates: (v.platform_version_release_dates ?? []).map((rd) => ({
      ...normalizeIgdbDate(rd.date, rd.date_format, (f) =>
        warn("未知的 date_format，視為 tbd", { igdbPlatformId: p.id, dateFormat: f }),
      ),
      regionCode: mapReleaseRegion(rd.release_region),
    })),
  }));

  return {
    igdbId: p.id,
    name: p.name ?? `Platform ${p.id}`,
    slug: p.slug ?? `platform-${p.id}`,
    abbreviation: blankToNull(p.abbreviation),
    alternativeName: blankToNull(p.alternative_name),
    kind,
    generation: p.generation ?? null,
    family,
    logoUrl: igdbImageUrl(p.platform_logo?.image_id),
    summary: blankToNull(p.summary),
    versions,
  };
}

// ── games ─────────────────────────────────────────────────────────────────

interface IgdbNamed {
  id: number;
  name?: string;
  slug?: string;
}

interface IgdbGame {
  id: number;
  name?: string;
  slug?: string;
  summary?: string;
  cover?: { image_id?: string };
  game_type?: number;
  game_status?: number;
  parent_game?: number;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  updated_at?: number;
  screenshots?: Array<{ image_id?: string }>;
  videos?: Array<{ video_id?: string }>;
  alternative_names?: Array<{ name?: string; comment?: string }>;
  game_localizations?: Array<{ name?: string; region?: number; cover?: { image_id?: string } }>;
  language_supports?: Array<{
    language?: { id: number; locale?: string; name?: string; native_name?: string };
    language_support_type?: number;
  }>;
  release_dates?: Array<{ date?: number; date_format?: number; platform?: number; release_region?: number; status?: number }>;
  platforms?: number[];
  genres?: IgdbNamed[];
  themes?: IgdbNamed[];
  involved_companies?: Array<{
    company?: IgdbNamed;
    developer?: boolean;
    publisher?: boolean;
    porting?: boolean;
    supporting?: boolean;
  }>;
  franchises?: IgdbNamed[];
  collections?: IgdbNamed[];
  similar_games?: number[];
  websites?: RawWebsite[];
  external_games?: RawExternalGame[];
}

/**
 * 04 §核心查詢；一個 games 請求展開全部關聯。
 * 與規格的差異：genres／themes 多取 slug（我方表 slug 必填）；platforms 只取 id；
 * 不取 release_dates.human（標籤由我方產生）、age_ratings（對照表 ❓，Phase 3b）、hypes（熱度另案）。
 */
export const GAME_FIELDS = [
  "name", "slug", "summary", "cover.image_id", "updated_at",
  "genres.name", "genres.slug", "themes.name", "themes.slug",
  "aggregated_rating", "aggregated_rating_count",
  "game_type", "game_status", "parent_game",
  "screenshots.image_id", "videos.video_id",
  "alternative_names.name", "alternative_names.comment",
  "game_localizations.name", "game_localizations.region", "game_localizations.cover.image_id",
  "language_supports.language.locale", "language_supports.language.name",
  "language_supports.language.native_name", "language_supports.language_support_type",
  "release_dates.date", "release_dates.date_format", "release_dates.platform",
  "release_dates.release_region", "release_dates.status",
  "platforms",
  "involved_companies.company.name", "involved_companies.company.slug",
  "involved_companies.developer", "involved_companies.publisher",
  "involved_companies.porting", "involved_companies.supporting",
  "franchises.name", "franchises.slug", "collections.name", "collections.slug",
  "similar_games",
  "websites.url", "websites.type",
  "external_games.url", "external_games.external_game_source", "external_games.uid",
].join(",");

/** 🧪 單款展開最多約 22 筆；超過記警告（不停止）。 */
const RELEASE_DATES_WARN_THRESHOLD = 22;
const SCREENSHOT_LIMIT = 6;

const toTaxonomy = (x: IgdbNamed, kind: string): TaxonomyRecord => ({
  igdbId: x.id,
  name: x.name ?? `${kind} ${x.id}`,
  slug: x.slug ?? `${kind}-${x.id}`,
});

function uniqueById<T extends { id: number }>(xs: readonly T[] | undefined): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const x of xs ?? []) {
    if (!x || typeof x.id !== "number" || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

export function toGameRecord(g: IgdbGame, warn: Warn = defaultWarn): GameRecord {
  const gameType = mapGameType(g.game_type);
  if (gameType.unmapped) warn("未知的 game_type，視為 other", { gameType: g.game_type });
  const gameStatus = mapGameStatus(g.game_status);
  if (gameStatus.unmapped) warn("未知的 game_status，視為一般狀態", { gameStatus: g.game_status });

  const releaseDates: GameReleaseDateRecord[] = [];
  for (const rd of g.release_dates ?? []) {
    if (rd.platform == null) continue;
    const stage = mapReleaseStage(rd.status);
    if (stage.unmapped) warn("未知的 release_dates.status，視為 unspecified", { status: rd.status });
    releaseDates.push({
      ...normalizeIgdbDate(rd.date, rd.date_format, (f) => warn("未知的 date_format，視為 tbd", { dateFormat: f })),
      platformIgdbId: rd.platform,
      regionCode: mapReleaseRegion(rd.release_region),
      stage: stage.value.stage,
      cancelled: stage.value.cancelled,
    });
  }
  if (releaseDates.length > RELEASE_DATES_WARN_THRESHOLD) {
    warn("單款上市日筆數超過預期", { igdbGameId: g.id, count: releaseDates.length });
  }

  const companies = new Map<number, GameCompanyRecord>();
  for (const ic of g.involved_companies ?? []) {
    if (!ic.company || typeof ic.company.id !== "number") continue;
    const roles: GameCompanyRole[] = [];
    if (ic.developer) roles.push("developer");
    if (ic.publisher) roles.push("publisher");
    if (ic.porting) roles.push("porting");
    if (ic.supporting) roles.push("supporting");
    const cur = companies.get(ic.company.id);
    if (cur) cur.roles = [...new Set([...cur.roles, ...roles])];
    else companies.set(ic.company.id, { company: toTaxonomy(ic.company, "company"), roles });
  }

  const franchises: FranchiseRecord[] = [
    ...uniqueById(g.franchises).map((f) => ({ ...toTaxonomy(f, "franchise"), kind: "franchise" as const })),
    ...uniqueById(g.collections).map((c) => ({ ...toTaxonomy(c, "collection"), kind: "collection" as const })),
  ];

  const localizations: GameLocalizationRecord[] = [];
  for (const l of g.game_localizations ?? []) {
    const name = l.name?.trim();
    if (!name) continue;
    const locale = mapLocalizationRegion(l.region);
    if (locale.unmapped) warn("未知的 game_localizations.region，略過", { region: l.region });
    if (!locale.value || localizations.some((x) => x.localeCode === locale.value)) continue;
    localizations.push({ localeCode: locale.value, name, coverUrl: igdbImageUrl(l.cover?.image_id, "t_cover_big", "jpg") });
  }

  const languageSupports: GameLanguageSupportRecord[] = [];
  for (const ls of g.language_supports ?? []) {
    const lang = ls.language;
    const supportType = mapLanguageSupportType(ls.language_support_type);
    if (!lang || typeof lang.id !== "number" || !supportType) continue;
    if (languageSupports.some((x) => x.language.igdbId === lang.id && x.supportType === supportType)) continue;
    languageSupports.push({
      language: {
        igdbId: lang.id,
        code: mapLanguageCode(lang.locale, lang.name, lang.id),
        name: lang.name ?? `Language ${lang.id}`,
        nativeName: blankToNull(lang.native_name),
      },
      supportType,
    });
  }

  const { links, unmapped } = buildGameLinks(g.websites ?? [], g.external_games ?? []);
  for (const u of unmapped) warn("外部連結出現新的字典 id，暫歸 other（請更新 link-map.ts）", { origin: u.origin, id: u.id });

  const rating = g.aggregated_rating;
  const ratingCount = g.aggregated_rating_count ?? 0;
  const firstVideo = (g.videos ?? []).find((v) => v.video_id)?.video_id;

  return {
    igdbId: g.id,
    name: g.name ?? `Game ${g.id}`,
    slug: g.slug ?? `game-${g.id}`,
    summary: blankToNull(g.summary),
    coverUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big", "jpg"),
    gameType: gameType.value,
    gameStatus: gameStatus.value,
    parentIgdbId: g.parent_game ?? null,
    alternativeNames: (g.alternative_names ?? [])
      .map((a) => ({ name: a.name?.trim() ?? "", comment: blankToNull(a.comment) }))
      .filter((a) => a.name !== ""),
    screenshotUrls: (g.screenshots ?? [])
      .map((s) => igdbImageUrl(s.image_id, "t_screenshot_big", "jpg"))
      .filter((u): u is string => u !== null)
      .slice(0, SCREENSHOT_LIMIT),
    trailerUrl: firstVideo ? `https://www.youtube.com/watch?v=${firstVideo}` : null,
    // 05：count 為 0 或缺少 → 無分數，不可顯示成 0 分
    criticScore:
      rating != null && Number.isFinite(rating) && ratingCount > 0
        ? { score: Math.round(rating), reviewCount: ratingCount }
        : null,
    sourceUpdatedAt: g.updated_at != null ? new Date(g.updated_at * 1000) : null,
    platformIgdbIds: [...new Set(g.platforms ?? [])],
    releaseDates,
    genres: uniqueById(g.genres).map((x) => toTaxonomy(x, "genre")),
    themes: uniqueById(g.themes).map((x) => toTaxonomy(x, "theme")),
    companies: [...companies.values()],
    franchises,
    localizations,
    languageSupports,
    links,
    steamAppId: steamAppIdOf(g.external_games ?? []),
    similarIgdbIds: [...new Set(g.similar_games ?? [])],
  };
}

// ── 活動（04 §活動同步） ─────────────────────────────────────────────────

interface IgdbEvent {
  id: number;
  name?: string;
  slug?: string;
  description?: string;
  start_time?: number;
  end_time?: number;
  time_zone?: string;
  event_logo?: { image_id?: string };
  live_stream_url?: string;
  games?: number[];
  updated_at?: number;
}

/** 2026-10-13 實測（events 共 960 筆；舊活動加入遊戲時 updated_at 會推進）。 */
export const EVENT_FIELDS = [
  "name", "slug", "description", "start_time", "end_time", "time_zone",
  "event_logo.image_id", "live_stream_url", "games", "updated_at",
].join(",");

const unixToDate = (s: number | null | undefined): Date | null => (s != null ? new Date(s * 1000) : null);

export function toEventRecord(e: IgdbEvent): EventRecord {
  const name = e.name?.trim() || `Event ${e.id}`;
  return {
    igdbId: e.id,
    name,
    slug: blankToNull(e.slug) ?? `event-${e.id}`,
    description: blankToNull(e.description),
    startTime: unixToDate(e.start_time),
    endTime: unixToDate(e.end_time),
    timeZone: blankToNull(e.time_zone),
    logoUrl: igdbImageUrl(e.event_logo?.image_id),
    streamUrl: blankToNull(e.live_stream_url),
    gameIgdbIds: [...new Set(e.games ?? [])],
    sourceUpdatedAt: unixToDate(e.updated_at),
  };
}

export function buildEventsWhere(q: FetchEventsQuery): string | undefined {
  return q.updatedSince ? `updated_at > ${Math.floor(q.updatedSince.getTime() / 1000)}` : undefined;
}

/** Apicalypse where 條件；全是數字，不會有注入問題。 */
export function buildGamesWhere(q: FetchGamesQuery): string | null {
  const conds: string[] = [];
  if (q.updatedSince) conds.push(`updated_at > ${Math.floor(q.updatedSince.getTime() / 1000)}`);
  if (q.afterId != null) conds.push(`id > ${Math.trunc(q.afterId)}`);
  if (q.ids) conds.push(`id = (${q.ids.map((i) => Math.trunc(i)).join(",")})`);
  if (q.firstReleaseFrom) conds.push(`first_release_date >= ${Math.floor(q.firstReleaseFrom.getTime() / 1000)}`);
  if (q.firstReleaseMissingWithDates) conds.push("first_release_date = null & release_dates != null");
  if (q.gameTypes) {
    const ids = gameTypeIds(q.gameTypes);
    // 空白名單（例如只給 other）→ 不可能命中的條件，而不是不加條件
    conds.push(ids.length > 0 ? `game_type = (${ids.join(",")})` : "id = 0");
  }
  return conds.length > 0 ? conds.join(" & ") : null;
}

export class IgdbProvider implements GameDataProvider, ExternalHypeSource {
  readonly sourceName = "igdb";
  /** 同一則警告（訊息＋內容相同）每個 Provider 實例只記一次，避免整批洗版。 */
  private readonly warnedKeys = new Set<string>();
  private readonly warnOnce: Warn = (message, extra) => {
    const key = `${message}|${JSON.stringify(extra ?? {})}`;
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    this.warn(message, extra);
  };

  constructor(
    private readonly client: IgdbClient,
    private readonly warn: Warn = defaultWarn,
  ) {}

  async fetchPlatforms(): Promise<PlatformRecord[]> {
    const rows = await this.client.queryAll<IgdbPlatform>("platforms", PLATFORM_FIELDS);
    return rows.map((p) => toPlatformRecord(p, this.warn));
  }

  /** 一頁（最多 IGDB_PAGE_SIZE 筆），依 id 升冪；續頁用最後一筆的 igdbId 當 afterId。 */
  async fetchGames(q: FetchGamesQuery): Promise<GameRecord[]> {
    if (q.ids && q.ids.length === 0) return [];
    const limit = Math.min(Math.max(1, Math.trunc(q.limit)), IGDB_PAGE_SIZE);
    const where = buildGamesWhere(q);
    const body = `fields ${GAME_FIELDS};${where ? ` where ${where};` : ""} sort id asc; limit ${limit};`;
    const rows = await this.client.query<IgdbGame>("games", body);
    return rows.map((g) => toGameRecord(g, this.warnOnce));
  }

  /** 活動數量少（約千筆），一次抓完全部頁。 */
  async fetchEvents(q: FetchEventsQuery): Promise<EventRecord[]> {
    const rows = await this.client.queryAll<IgdbEvent>("events", EVENT_FIELDS, buildEventsWhere(q));
    return rows.map(toEventRecord);
  }

  /** 外部連結字典漂移（04 §外部連結）：website_types、external_game_sources 出現對照表沒見過的 id。 */
  async checkDictionaryDrift(): Promise<DictionaryDrift[]> {
    const [websiteTypes, sources] = await Promise.all([
      this.client.queryAll<{ id: number; type?: string }>("website_types", "type"),
      this.client.queryAll<{ id: number; name?: string }>("external_game_sources", "name"),
    ]);
    const drift = (dictionary: string, known: readonly number[], rows: Array<{ id: number; label?: string }>) => {
      const fresh = new Set(findNewDictionaryIds(known, rows.map((r) => r.id)));
      return { dictionary, newEntries: rows.filter((r) => fresh.has(r.id)).map((r) => ({ id: r.id, name: r.label ?? "" })) };
    };
    return [
      drift("website_types", KNOWN_WEBSITE_TYPE_IDS, websiteTypes.map((r) => ({ id: r.id, label: r.type }))),
      drift("external_game_sources", KNOWN_EXTERNAL_GAME_SOURCE_IDS, sources.map((r) => ({ id: r.id, label: r.name }))),
    ];
  }

  /** 熱度原始訊號版本（03 §熱度）：各種類最新的 calculated_at；每種類 1 個請求。 */
  async fetchHypeVersion(): Promise<ExternalHypeVersion> {
    return fetchIgdbHypeVersion(this.client);
  }

  /** 熱度原始訊號（popularity_primitives 類型 2、10）全量；格式轉換在 igdb/popularity.ts。 */
  async fetchHypeRecords(): Promise<ExternalHypeRecord[]> {
    return fetchIgdbHypeRecords(this.client);
  }
}

// ── 行程內共用的 limiter 與 token（HMR 重新載入也不重建） ─────────────────

type Shared = { limiter?: RequestLimiter; tokens?: Map<string, TwitchTokenCache> };
const g = globalThis as typeof globalThis & { __sokIgdb?: Shared };
const shared: Shared = (g.__sokIgdb ??= {});

function sharedLimiter(): RequestLimiter {
  return (shared.limiter ??= new RequestLimiter([new TokenBucket(IGDB_MAX_REQ_PER_SEC)], IGDB_MAX_CONCURRENT));
}

function sharedTokens(clientId: string, clientSecret: string): TwitchTokenCache {
  shared.tokens ??= new Map();
  let t = shared.tokens.get(clientId);
  if (!t) {
    t = new TwitchTokenCache(clientId, clientSecret);
    shared.tokens.set(clientId, t);
  }
  return t;
}

export interface GetIgdbProviderOptions {
  /** 額外限速（回填用 BACKFILL_MAX_REQ_PER_SEC），疊在全域 4/s 之上，額度留給增量同步。 */
  maxReqPerSec?: number;
  warn?: Warn;
}

/** 以環境變數建立 Provider；缺憑證 → ConfigError（catalog manifest 也會在啟動時擋下）。 */
export function getIgdbProvider(opts: GetIgdbProviderOptions = {}): IgdbProvider {
  const env = getCoreEnv();
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    throw new ConfigError("缺少 IGDB_CLIENT_ID 或 IGDB_CLIENT_SECRET");
  }
  const base = sharedLimiter();
  const limiter = opts.maxReqPerSec ? base.withExtraBucket(new TokenBucket(opts.maxReqPerSec)) : base;
  const client = new IgdbClient({
    clientId: env.IGDB_CLIENT_ID,
    tokens: sharedTokens(env.IGDB_CLIENT_ID, env.IGDB_CLIENT_SECRET),
    limiter,
  });
  return new IgdbProvider(client, opts.warn);
}
