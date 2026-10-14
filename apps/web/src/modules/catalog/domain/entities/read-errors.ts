// 讀取查詢的錯誤型別（Domain，零外部依賴）。HTTP 對應由 UI／API 層處理。

/** 查詢超過 statement_timeout（06 §篩選：高成本組合逾時回 503 並提示縮小範圍）。 */
export class CatalogQueryTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`查詢逾時（${timeoutMs} ms），請縮小篩選範圍`, options);
    this.name = "CatalogQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isCatalogQueryTimeoutError(err: unknown): err is CatalogQueryTimeoutError {
  return err instanceof CatalogQueryTimeoutError || (err instanceof Error && err.name === "CatalogQueryTimeoutError");
}
