/**
 * 後台可調設定的讀寫（12 §設定頁）。kernel 層的橫切基礎設施：catalog／metacritic 讀、admin 寫。
 *
 * - 讀：帶短 TTL（SETTINGS_TTL_MS）的行程內快取；沒有列＝回 undefined（呼叫端退回環境變數／內建預設）。
 *   資料庫讀不到（沒設 DATABASE_URL、連線失敗）也只回空集合，不讓設定頁以外的頁面因此壞掉。
 * - 寫：一個 transaction 寫設定與稽核（誰、何時、舊值→新值）；寫完立刻清本行程的快取，其他行程最多 TTL 後生效。
 * - 這裡只檢查「型別形狀」（布林／字串清單）；「清單裡的值合不合法」（遊戲類型、評分來源…）由擁有該領域的模組驗證後才呼叫 updateSettings。
 */
import { applySettingChanges, readAllSettingRows, readSettingAudit, type SettingAuditRow } from "../db/settings";

export const SETTING_KEYS = [
  "ratings.visibleProviders",
  "ratings.priority",
  "ratings.showMetascore",
  "ratings.showUserscore",
  "calendar.defaultGameTypes",
  "calendar.defaultStages",
  "metacritic.scrapeAllowed",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** 每個鍵的值形狀。 */
export const SETTING_SHAPES: Readonly<Record<SettingKey, "boolean" | "list">> = {
  "ratings.visibleProviders": "list",
  "ratings.priority": "list",
  "ratings.showMetascore": "boolean",
  "ratings.showUserscore": "boolean",
  "calendar.defaultGameTypes": "list",
  "calendar.defaultStages": "list",
  "metacritic.scrapeAllowed": "boolean",
};

export type SettingValue = boolean | string[];

export const SETTINGS_TTL_MS = 30_000;
const LIST_MAX = 40;

export function isSettingKey(v: unknown): v is SettingKey {
  return typeof v === "string" && (SETTING_KEYS as readonly string[]).includes(v);
}

/** 值是否符合該鍵的形狀。 */
export function isValidSettingShape(key: SettingKey, value: unknown): value is SettingValue {
  if (SETTING_SHAPES[key] === "boolean") return typeof value === "boolean";
  return Array.isArray(value) && value.length <= LIST_MAX && value.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64);
}

interface Cache {
  at: number;
  values: Map<SettingKey, SettingValue>;
}
const g = globalThis as typeof globalThis & { __sokSettingsCache?: Cache | null };

export function clearSettingsCache(): void {
  g.__sokSettingsCache = null;
}

/** now 預設用 performance.now()（單調時鐘；Next 的 prerender 不允許 Date.now()）。目前所有已設定的值（鍵不存在＝沒設）。快取 SETTINGS_TTL_MS；讀取失敗回空集合（也快取，避免連續打爆壞掉的連線）。 */
export async function getSettings(now: number = performance.now()): Promise<ReadonlyMap<SettingKey, SettingValue>> {
  const c = g.__sokSettingsCache;
  if (c && now - c.at < SETTINGS_TTL_MS) return c.values;
  const values = new Map<SettingKey, SettingValue>();
  try {
    for (const row of await readAllSettingRows()) {
      if (isSettingKey(row.key) && isValidSettingShape(row.key, row.value)) values.set(row.key, row.value);
    }
  } catch {
    /* 讀不到就當作都沒設 */
  }
  g.__sokSettingsCache = { at: now, values };
  return values;
}

/**
 * Metacritic 抓取的兩道開關（05、12）：環境變數 METACRITIC_SCRAPE_ENABLED 與後台設定 metacritic.scrapeAllowed 都開才算允許。
 * 後台旗標沒設＝關（預設關閉的第二道保險：只改環境變數不會開始抓）。
 */
export async function isMetacriticScrapeAllowed(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.METACRITIC_SCRAPE_ENABLED !== "true") return false;
  return (await getSettings()).get("metacritic.scrapeAllowed") === true;
}

export interface SettingChange {
  key: SettingKey;
  /** null＝還原成預設（刪除該列）。 */
  value: SettingValue | null;
}

export interface AppliedSettingChange {
  key: SettingKey;
  oldValue: unknown;
  newValue: unknown;
}

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 套用一批變更並寫稽核。與目前值相同的項目略過（不寫稽核）。actor 是操作者（後台為 Basic auth 的使用者名稱）。
 * 回傳實際有變動的項目。
 */
export async function updateSettings(changes: readonly SettingChange[], actor: string): Promise<AppliedSettingChange[]> {
  const who = actor.trim();
  if (who === "" || who.length > 128) throw new SettingsValidationError("actor 不合法");
  const seen = new Set<string>();
  for (const c of changes) {
    if (!isSettingKey(c.key)) throw new SettingsValidationError(`未知的設定鍵：${String(c.key)}`);
    if (seen.has(c.key)) throw new SettingsValidationError(`設定鍵重複：${c.key}`);
    seen.add(c.key);
    if (c.value !== null && !isValidSettingShape(c.key, c.value)) throw new SettingsValidationError(`設定值的形狀不合法：${c.key}`);
  }
  // 直接讀資料庫（不經快取）決定哪些真的有變，避免用過期的快取漏寫
  const current = new Map<string, unknown>((await readAllSettingRows()).map((r) => [r.key, r.value] as const));
  const effective = changes.filter((c) => (c.value === null ? current.has(c.key) : !current.has(c.key) || !same(current.get(c.key), c.value)));
  const applied = await applySettingChanges(effective, who);
  clearSettingsCache();
  return applied as AppliedSettingChange[];
}

export type { SettingAuditRow };

/** 最近的設定變更（新到舊）。 */
export async function listSettingAudit(limit = 50, key?: SettingKey): Promise<SettingAuditRow[]> {
  return readSettingAudit(Math.min(Math.max(1, Math.floor(limit)), 200), key);
}
