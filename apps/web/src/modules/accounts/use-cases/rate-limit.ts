/**
 * 帳號端點的固定視窗限流（每使用者、記憶體計數）。部署是單一 VM（16），記憶體足夠；重啟歸零，要多實例時改為資料庫計數。
 * 掛在 globalThis：開發模式 HMR 重新載入模組時不歸零。
 */
export interface RateRule {
  max: number;
  windowMs: number;
}

type Bucket = { count: number; resetAt: number };
const g = globalThis as typeof globalThis & { __sokAccountRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__sokAccountRate ??= new Map());

/** 消耗一次額度。回傳是否允許；被擋時 retryAfterSeconds 是還要等多久。 */
export function consumeRate(name: string, userId: number, rule: RateRule, now: number = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const key = `${name}:${userId}`;
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }
  if (cur.count >= rule.max) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  cur.count += 1;
  return { ok: true };
}

/** 測試用。 */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
