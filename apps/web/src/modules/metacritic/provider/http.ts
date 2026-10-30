/**
 * 對 metacritic.com 的唯一出口（05 §Metacritic 抓取）。所有請求都經這裡：
 * - 開關：每次請求前呼叫 gate()；不允許就丟 MetacriticDisabledError，**不發出任何請求**（關閉時請求數為 0）。
 * - robots.txt：每 24 小時重抓一次，`User-agent: *` 的 Disallow 一律遵守（觀察到 `/search` 被禁，所以不用站內搜尋）。
 * - 限速：請求之間至少 minIntervalMs（預設 1100 ms，每秒不超過 1 次）、帶可辨識的 User-Agent。
 * - 退避：429／5xx 依 Retry-After 或指數退避重試（最多 maxRetries 次），仍失敗丟 MetacriticTransientError。
 * - 失效不升級：403／401／挑戰頁一律丟 MetacriticBlockedError，**不重試、不偽裝瀏覽器指紋、不輪替 IP、不解 CAPTCHA**。
 */
import { isPathAllowed, looksLikeChallenge, parseRobotsDisallow } from "./parse";

export const METACRITIC_ORIGIN = "https://www.metacritic.com";
export const DEFAULT_USER_AGENT = "GameDexBot/0.1 (+https://github.com/ISOCASSELGenMi/GameDex; game release calendar; low-rate rating sync)";

export class MetacriticDisabledError extends Error {
  constructor() {
    super("Metacritic 抓取未啟用（環境變數與後台設定需兩者皆開）");
    this.name = "MetacriticDisabledError";
  }
}
export class MetacriticDisallowedError extends Error {
  constructor(path: string) {
    super(`robots.txt 不允許抓取 ${path}`);
    this.name = "MetacriticDisallowedError";
  }
}
export class MetacriticBlockedError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`被 metacritic.com 擋下（HTTP ${status}：${detail}）；依規定不繞過，停止抓取`);
    this.name = "MetacriticBlockedError";
  }
}
export class MetacriticTransientError extends Error {
  constructor(public readonly status: number) {
    super(`metacritic.com 暫時無法回應（HTTP ${status}），重試後仍失敗`);
    this.name = "MetacriticTransientError";
  }
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface MetacriticHttpOptions {
  gate: () => Promise<boolean>;
  userAgent?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_CAP_MS = 60_000;

export class MetacriticHttp {
  /** 本實例發出的請求數（含 robots.txt）；任務結束時用來扣每日額度與記 log。 */
  requests = 0;
  private lastAt = 0;
  private robots: { at: number; disallow: string[] } | null = null;
  private readonly o: Required<Omit<MetacriticHttpOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(options: MetacriticHttpOptions) {
    this.o = {
      userAgent: DEFAULT_USER_AGENT,
      minIntervalMs: 1100,
      maxRetries: 2,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      fetchImpl: (...a) => fetch(...a),
      ...options,
    } as Required<Omit<MetacriticHttpOptions, "fetchImpl">> & { fetchImpl: typeof fetch };
  }

  private async throttle(): Promise<void> {
    const wait = this.lastAt + this.o.minIntervalMs - this.o.now();
    if (wait > 0) await this.o.sleep(wait);
    this.lastAt = this.o.now();
  }

  private async raw(path: string, accept: string): Promise<HttpResponse> {
    if (!(await this.o.gate())) throw new MetacriticDisabledError();
    let attempt = 0;
    for (;;) {
      await this.throttle();
      this.requests += 1;
      const res = await this.o.fetchImpl(`${METACRITIC_ORIGIN}${path}`, {
        headers: { "User-Agent": this.o.userAgent, Accept: accept, "Accept-Language": "en-US,en;q=0.8" },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.o.maxRetries) throw new MetacriticTransientError(res.status);
        const ra = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt;
        attempt += 1;
        await this.o.sleep(Math.min(backoff, RETRY_AFTER_CAP_MS));
        continue;
      }
      if (looksLikeChallenge(res.status, body)) throw new MetacriticBlockedError(res.status, "驗證碼或反機器人頁面");
      return { status: res.status, body };
    }
  }

  private async disallowList(): Promise<string[]> {
    const t = this.o.now();
    if (this.robots && t - this.robots.at < ROBOTS_TTL_MS) return this.robots.disallow;
    // robots.txt 本身讀不到（非 200）時保守地當作全部禁止，不猜
    const res = await this.raw("/robots.txt", "text/plain");
    const disallow = res.status === 200 ? parseRobotsDisallow(res.body) : ["/"];
    this.robots = { at: t, disallow };
    return disallow;
  }

  /** GET 一個站內路徑（必須以 / 開頭）。404 照實回傳（status=404），由呼叫端決定怎麼處理。 */
  async get(path: string, accept = "text/html"): Promise<HttpResponse> {
    if (!path.startsWith("/")) throw new Error("path 必須以 / 開頭");
    if (!(await this.o.gate())) throw new MetacriticDisabledError();
    const disallow = await this.disallowList();
    if (!isPathAllowed(path, disallow)) throw new MetacriticDisallowedError(path);
    return this.raw(path, accept);
  }
}
