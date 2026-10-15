/**
 * 頁面層的錯誤對應。
 * App Router 的頁面無法回 503（只有 notFound／forbidden／unauthorized 能改狀態碼）：查詢逾時改丟帶固定 digest 的錯誤，
 * 由 [locale]/error.tsx 顯示「縮小範圍」提示（狀態碼為 500，見報告）。
 */
import { isCatalogQueryTimeoutError } from "../domain/entities/read-errors";

export const QUERY_TIMEOUT_DIGEST = "SOK_QUERY_TIMEOUT";

export class QueryTimeoutPageError extends Error {
  readonly digest = QUERY_TIMEOUT_DIGEST;
  constructor(options?: { cause?: unknown }) {
    super("catalog query timed out", options);
    this.name = "QueryTimeoutPageError";
  }
}

/** catch 區塊用：逾時 → QueryTimeoutPageError；其他錯誤原樣丟出。 */
export function rethrowForPage(err: unknown): never {
  if (isCatalogQueryTimeoutError(err)) throw new QueryTimeoutPageError({ cause: err });
  throw err;
}

// ── `use cache` 邊界 ─────────────────────────────────────────────────────────
// 從 `use cache` 函式內丟出的錯誤跨過快取邊界後會被 Next 重建成一般錯誤（型別與名稱遺失、digest 隨機），
// 外層的 rethrowForPage 認不出它是查詢逾時，頁面就顯示一般錯誤而非「縮小範圍」提示。
// 所以快取函式內要自己攔下逾時，以 CACHED_TIMEOUT 這個可序列化的標記值回傳（並把這筆結果的快取壽命縮到最短），
// 外層再用 unwrapCachedForPage 還原成 QueryTimeoutPageError。其他錯誤照舊原樣丟出。

/** 快取函式回傳的「查詢逾時」標記（純物件，可通過快取序列化）。 */
export const CACHED_TIMEOUT = { cachedQueryTimeout: true } as const;
export type CachedTimeout = typeof CACHED_TIMEOUT;

function isCachedTimeout(v: unknown): v is CachedTimeout {
  return typeof v === "object" && v !== null && (v as { cachedQueryTimeout?: unknown }).cachedQueryTimeout === true;
}

/** 快取函式的 catch 區塊用：逾時 → 回傳 CACHED_TIMEOUT（呼叫端先把 cacheLife 設短）；其他錯誤原樣丟出。 */
export function timeoutMarkerOrRethrow(err: unknown): CachedTimeout {
  if (isCatalogQueryTimeoutError(err)) return CACHED_TIMEOUT;
  throw err;
}

/** 快取函式外層用：標記值 → QueryTimeoutPageError；否則回傳原值。 */
export function unwrapCachedForPage<T>(value: T | CachedTimeout): T {
  if (isCachedTimeout(value)) throw new QueryTimeoutPageError();
  return value;
}
