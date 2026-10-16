import { sql } from "drizzle-orm";
import { getCoreEnv } from "@/kernel/config/env";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { CatalogQueryTimeoutError } from "../domain/entities";

/**
 * 讀取查詢的 statement_timeout（06 §篩選：高成本組合逾時回 503）。
 * 本機實測月曆 < 300 ms、詳情 < 150 ms（docs/perf/2026-10-13-calendar-query.md），3 秒是保護上限，不是預期值。
 */
export const READ_STATEMENT_TIMEOUT_MS = 3000;

export interface ReadOptions {
  db?: DbOrTx;
  /** 覆寫 statement_timeout（毫秒）；測試用。 */
  timeoutMs?: number;
}

/** PostgreSQL query_canceled（statement_timeout 觸發）。drizzle 會把 pg 錯誤包在 cause 裡。 */
export function isStatementTimeout(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "57014") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 在唯讀 transaction 內以 SET LOCAL statement_timeout 執行讀取；逾時丟 CatalogQueryTimeoutError。
 */
export async function withReadTimeout<T>(fn: (tx: DbOrTx) => Promise<T>, opts: ReadOptions = {}): Promise<T> {
  const db = opts.db ?? getDb();
  const ms = Math.max(1, Math.floor(opts.timeoutMs ?? getCoreEnv().CATALOG_READ_TIMEOUT_MS ?? READ_STATEMENT_TIMEOUT_MS));
  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${ms}`));
        return fn(tx);
      },
      { accessMode: "read only" },
    );
  } catch (err) {
    if (isStatementTimeout(err)) throw new CatalogQueryTimeoutError(ms, { cause: err });
    throw err;
  }
}

/** timestamptz（pg 回傳 Date）→ ISO 字串。 */
export function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** 把 JS 陣列當成單一 PostgreSQL 陣列參數（drizzle 預設會展開成 ($1, $2…)）。 */
export const pgArray = (values: readonly (string | number)[]) => sql.param([...values]);
