/**
 * IGDB Provider（04）：Twitch OAuth token 快取、節流（4/s＋並發 8）、Apicalypse 查詢、轉 Domain 型別。
 * 只在伺服器端使用（IGDB 不開 CORS，瀏覽器呼叫也會洩漏 Client Secret）。直接用 fetch，不引入 igdb-api-node。
 */
import { ConfigError, getCoreEnv } from "@/kernel/config/env";
import type { PlatformFamilyRecord, PlatformRecord, PlatformReleaseDateRecord } from "../domain/entities";
import type { GameDataProvider } from "./game-data-provider.interface";
import { normalizeIgdbDate } from "./igdb/dates";
import { igdbImageUrl, mapPlatformKind, mapReleaseRegion } from "./igdb/mappings";
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

  const releaseDates: PlatformReleaseDateRecord[] = [];
  for (const v of p.versions ?? []) {
    for (const rd of v.platform_version_release_dates ?? []) {
      const span = normalizeIgdbDate(rd.date, rd.date_format, (f) =>
        warn("未知的 date_format，視為 tbd", { igdbPlatformId: p.id, dateFormat: f }),
      );
      releaseDates.push({ ...span, regionCode: mapReleaseRegion(rd.release_region) });
    }
  }

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
    releaseDates,
  };
}

export class IgdbProvider implements GameDataProvider {
  readonly sourceName = "igdb";

  constructor(
    private readonly client: IgdbClient,
    private readonly warn: Warn = defaultWarn,
  ) {}

  async fetchPlatforms(): Promise<PlatformRecord[]> {
    const rows = await this.client.queryAll<IgdbPlatform>("platforms", PLATFORM_FIELDS);
    return rows.map((p) => toPlatformRecord(p, this.warn));
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
