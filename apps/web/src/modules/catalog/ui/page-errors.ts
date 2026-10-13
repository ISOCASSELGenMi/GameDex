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
