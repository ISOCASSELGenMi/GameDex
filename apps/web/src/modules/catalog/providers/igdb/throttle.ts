/**
 * IGDB 節流（04 §認證與節流）：token bucket（每秒 N 次）＋ semaphore（同時最多 M 個未完成請求）。
 * 額度綁在憑證上、全應用共用，所以同一個行程只建一組（見 igdb.ts 的 sharedLimiter）。
 * 多個行程（例如 dev server 與手動執行的腳本）不共用記憶體，各自計算——同時跑時要留意。
 */

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 每秒補 ratePerSec 個 token，最多存 burst 個。acquire() 依呼叫順序（FIFO）取得。
 * burst 預設 1：請求均勻分散，不會在同一瞬間連發。
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSec: number,
    private readonly burst = 1,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {
    if (!(ratePerSec > 0)) throw new RangeError(`ratePerSec 必須 > 0：${ratePerSec}`);
    if (!(burst >= 1)) throw new RangeError(`burst 必須 >= 1：${burst}`);
    this.tokens = burst;
    this.last = now();
  }

  acquire(): Promise<void> {
    const next = this.chain.then(() => this.take());
    // 鏈本身不能因單次失敗而斷掉
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    }
  }
}

/** 計數 semaphore，FIFO。release() 必須在 finally 呼叫（逾時也要釋放名額）。 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!(max >= 1)) throw new RangeError(`max 必須 >= 1：${max}`);
  }

  get inUse(): number {
    return this.active;
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    // 直接把名額交給下一位，active 不變
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

/** semaphore → 各個 bucket 依序取 token → 執行；不論成功、失敗或逾時都釋放 semaphore。 */
export class RequestLimiter {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly buckets: readonly TokenBucket[],
    maxConcurrent: number | Semaphore,
  ) {
    this.semaphore = typeof maxConcurrent === "number" ? new Semaphore(maxConcurrent) : maxConcurrent;
  }

  get inFlight(): number {
    return this.semaphore.inUse;
  }

  /** 加上額外的 bucket（例如回填另限 2/s），共用同一個 semaphore 與基本 bucket。 */
  withExtraBucket(bucket: TokenBucket): RequestLimiter {
    return new RequestLimiter([...this.buckets, bucket], this.semaphore);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    try {
      for (const b of this.buckets) await b.acquire();
      return await fn();
    } finally {
      this.semaphore.release();
    }
  }
}
