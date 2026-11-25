/**
 * Steam 對 Metacritic 頁面的記錄（配對佐證）。Steam 商店資料介面（appdetails）對有 Metacritic 分數的遊戲會附 `metacritic.url`，
 * 例如 https://www.metacritic.com/game/pc/<slug>?ftag=…；沒有分數的遊戲沒有這個欄位。覆蓋率有限，只能當佐證，不能取代標題＋日期比對。
 * 外部格式（URL、JSON）到此為止，上層只拿到 slug。查不到或出錯一律回 undefined（未知），不影響配對判斷。
 */
const APPDETAILS = "https://store.steampowered.com/api/appdetails";

/** Metacritic 網址 → slug。支援 /game/<slug>/ 與 /game/<platform>/<slug>（Steam 常給 PC 版）。 */
export function metacriticSlugFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "www.metacritic.com" && u.hostname !== "metacritic.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] !== "game" || parts.length < 2 || parts.length > 3) return null;
  const slug = parts[parts.length - 1]!;
  return /^[a-z0-9][a-z0-9-]{0,200}$/.test(slug) ? slug : null;
}

export interface SteamHintClient {
  /** Steam 記錄的 Metacritic slug；Steam 沒有記錄回 null；查詢失敗或被限流回 undefined（未知）。 */
  getMetacriticSlug(appId: string): Promise<string | null | undefined>;
}

export interface SteamHintOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 兩次請求的最小間隔（Steam 約每 5 分鐘 200 次）。 */
  minIntervalMs?: number;
}

export function createSteamHintClient(opts: SteamHintOptions = {}): SteamHintClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minInterval = opts.minIntervalMs ?? 1600;
  let last = 0;
  let limited = false; // 被限流後本輪不再問
  const cache = new Map<string, string | null>();
  return {
    async getMetacriticSlug(appId) {
      if (!/^\d{1,10}$/.test(appId)) return undefined;
      if (cache.has(appId)) return cache.get(appId);
      if (limited) return undefined;
      const wait = last + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await doFetch(`${APPDETAILS}?appids=${appId}&filters=metacritic&cc=us`, { headers: { accept: "application/json" } });
        if (res.status === 429 || res.status === 403) {
          limited = true;
          return undefined;
        }
        if (res.status !== 200) return undefined;
        const json = (await res.json()) as Record<string, { success?: boolean; data?: { metacritic?: { url?: unknown } } | unknown[] }>;
        const entry = json[appId];
        if (!entry || entry.success !== true) return undefined;
        const data = Array.isArray(entry.data) ? undefined : entry.data;
        const url = data?.metacritic?.url;
        const slug = typeof url === "string" ? metacriticSlugFromUrl(url) : null;
        cache.set(appId, slug);
        return slug;
      } catch {
        return undefined;
      }
    },
  };
}
