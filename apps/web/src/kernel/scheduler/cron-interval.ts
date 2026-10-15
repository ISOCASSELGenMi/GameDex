/**
 * 由 5 欄位 cron 表示式推算「預期間隔」（兩次執行之間最長的空檔，毫秒）。純函式，給任務心跳告警用（16 §Uptime 與告警）。
 * 支援 `*`、`a`、`a-b`、`a,b`、`步進`（星號或範圍後接 `/n`，例如每 6 小時）、`a/n`（分、時、日、月、週；週 0 與 7 皆為週日；
 * 月份與週的英文縮寫不支援）。時間一律以 UTC 判斷。
 * 以固定的一段時間（預設 40 天）逐分鐘掃描取最長空檔，所以「每月 1 號」這種也能算；掃描不到兩次執行就回 null。
 */

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dow", min: 0, max: 7 },
] as const;

function parseField(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = min;
      hi = max;
    } else if (m[1].includes("-")) {
      [lo, hi] = m[1].split("-").map(Number) as [number, number];
    } else {
      lo = Number(m[1]);
      // `a/n` ＝ 從 a 開始每 n 到上限；單獨的 `a` 只有 a
      hi = m[2] === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface CronMatcher {
  matches(d: Date): boolean;
}

/** 解析 cron（以 UTC 判斷）；無效回 null。 */
export function parseCron(expr: string): CronMatcher | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, FIELDS[i].min, FIELDS[i].max));
  if (sets.some((s) => s === null)) return null;
  const [minute, hour, dom, month, dowRaw] = sets as Set<number>[];
  const dow = new Set([...dowRaw].map((v) => v % 7));
  const domRestricted = parts[2] !== "*";
  const dowRestricted = parts[4] !== "*";
  return {
    matches(d) {
      if (!minute.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !month.has(d.getUTCMonth() + 1)) return false;
      const domOk = dom.has(d.getUTCDate());
      const dowOk = dow.has(d.getUTCDay());
      // cron 慣例：日與週都有限制時，任一符合即可
      if (domRestricted && dowRestricted) return domOk || dowOk;
      return domOk && dowOk;
    },
  };
}

const MINUTE_MS = 60_000;

/** 兩次執行之間最長的空檔（毫秒）；表示式無效或掃描範圍內少於兩次執行回 null。 */
export function cronMaxIntervalMs(expr: string, opts: { days?: number } = {}): number | null {
  const matcher = parseCron(expr);
  if (!matcher) return null;
  const days = opts.days ?? 40;
  const start = Date.UTC(2026, 0, 1, 0, 0, 0); // 固定起點：結果只和表示式有關
  let prev: number | null = null;
  let max = 0;
  for (let i = 0; i < days * 24 * 60; i += 1) {
    const t = start + i * MINUTE_MS;
    if (!matcher.matches(new Date(t))) continue;
    if (prev !== null) max = Math.max(max, t - prev);
    prev = t;
  }
  return max === 0 ? null : max;
}
