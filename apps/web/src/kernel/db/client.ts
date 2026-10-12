import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCoreEnv } from "../config/env";

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Repository 函式可接受 db 或 transaction，讓 Use Case 決定交易邊界。 */
export type DbOrTx = Db | Tx;

type Holder = { pool?: Pool; db?: Db };
// 開發模式 HMR 會重新載入模組；掛在 globalThis 避免連線池重複建立。
const g = globalThis as typeof globalThis & { __sokDb?: Holder };
const holder: Holder = (g.__sokDb ??= {});

export function getPool(): Pool {
  if (!holder.pool) {
    holder.pool = new Pool({ connectionString: getCoreEnv().DATABASE_URL, max: 10 });
  }
  return holder.pool;
}

/** 唯一的 Drizzle 實例。只有 repository/ 與 kernel/db/ 可以使用（02 §CI 邊界檢查 c）。 */
export function getDb(): Db {
  if (!holder.db) holder.db = drizzle(getPool());
  return holder.db;
}

export async function closeDb(): Promise<void> {
  const pool = holder.pool;
  holder.pool = undefined;
  holder.db = undefined;
  await pool?.end();
}
