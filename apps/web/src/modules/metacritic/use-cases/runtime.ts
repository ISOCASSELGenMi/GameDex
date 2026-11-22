/**
 * metacritic 任務的共用執行環境：每日請求額度、被擋後的冷卻、告警、建立 http 用戶端。
 * 額度與冷卻存在 sync_state（kernel 的任務狀態表）的專用列，重啟後仍有效。
 */
import { sendAlertWebhook } from "@/kernel/alerts/webhook";
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import { isMetacriticScrapeAllowed } from "@/kernel/settings";
import { MetacriticHttp, type MetacriticHttpOptions } from "../provider/http";

export const BUDGET_STATE = "metacritic_budget";
export const BLOCKED_STATE = "metacritic_blocked";
export const DEFAULT_DAILY_LIMIT = 500;
/** 被擋（403／挑戰頁）後的冷卻：24 小時內所有任務直接跳過。 */
export const BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function dailyRequestLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.METACRITIC_DAILY_REQUEST_LIMIT);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : DEFAULT_DAILY_LIMIT;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export interface Budget {
  /** 今天還能用的請求數（即時：已掛上 track 的請求即使還沒寫入資料庫也已扣除）。 */
  remaining(): number;
  /** 直接記下已用掉 n 個請求並存檔（向後相容；有 track 時不需要）。 */
  spend(n: number): Promise<void>;
  /** 掛到 http 上：每個請求即時累計，每 batch 個請求寫入一次（行程被殺最多少算 batch−1 個）。 */
  track(http: MetacriticHttp, batch?: number): void;
  /** 把還沒寫入的用量寫入；任務結束（finally）呼叫。寫的是絕對值，重複呼叫不會重複扣。 */
  flush(): Promise<void>;
}

/** 每幾個請求寫入一次用量。 */
export const BUDGET_FLUSH_EVERY = 5;

/** 兩個任務（repair_matches_metacritic、sync_ratings）與索引更新共用同一個每日額度（05）。 */
export async function loadBudget(now: Date = new Date(), limit: number = dailyRequestLimit()): Promise<Budget> {
  const state = await getSyncState(BUDGET_STATE);
  const meta = (state?.meta ?? {}) as { day?: string; used?: number };
  let used = meta.day === dayOf(now) && typeof meta.used === "number" ? meta.used : 0;
  let saved = used;
  const flush = async () => {
    if (used === saved) return;
    const target = used;
    await saveSyncProgress(BUDGET_STATE, { meta: { day: dayOf(now), used: target, limit } });
    saved = target;
  };
  return {
    remaining: () => Math.max(0, limit - used),
    async spend(n) {
      used += n;
      await flush();
    },
    track(http, batch = BUDGET_FLUSH_EVERY) {
      http.onRequest = async () => {
        used += 1;
        if (used - saved >= batch) await flush();
      };
    },
    flush,
  };
}

export async function blockedUntil(): Promise<Date | null> {
  const state = await getSyncState(BLOCKED_STATE);
  const until = (state?.meta as { until?: string } | null)?.until;
  const d = until ? new Date(until) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export async function markBlocked(reason: string, now: Date = new Date(), alert: (m: string) => Promise<unknown> = defaultAlert): Promise<void> {
  const until = new Date(now.getTime() + BLOCK_COOLDOWN_MS);
  await saveSyncProgress(BLOCKED_STATE, { meta: { until: until.toISOString(), reason: reason.slice(0, 300) } });
  await alert(`[GameDex] Metacritic 抓取被擋，已暫停 24 小時（不會繞過）：${reason}`);
}

export async function defaultAlert(message: string): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  return url ? sendAlertWebhook(url, message) : false;
}

export type GateResult = { run: true } | { run: false; reason: string };

/** 任務開頭的檢查：兩道開關、冷卻期、當日額度。run=false 時任務應直接結束（不發出任何請求）。 */
export async function checkCanRun(now: Date = new Date()): Promise<GateResult> {
  if (!(await isMetacriticScrapeAllowed())) return { run: false, reason: "Metacritic 抓取未允許：環境變數 METACRITIC_SCRAPE_ENABLED 與後台設定「允許抓取」需兩者皆開" };
  const until = await blockedUntil();
  if (until && until.getTime() > now.getTime()) return { run: false, reason: `先前被擋，冷卻到 ${until.toISOString()}` };
  return { run: true };
}

export function createHttp(overrides: Partial<MetacriticHttpOptions> = {}): MetacriticHttp {
  const ua = process.env.METACRITIC_USER_AGENT;
  return new MetacriticHttp({ gate: () => isMetacriticScrapeAllowed(), ...(ua ? { userAgent: ua } : {}), ...overrides });
}
