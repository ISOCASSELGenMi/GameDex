import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./client";

/**
 * 鎖名 → 雙 int4 key（避免 JS 53-bit 整數問題，04 §併發保護）。
 * 同名永遠得到同一對 key。
 */
export function lockKeyPair(name: string): [number, number] {
  const buf = createHash("sha256").update(name, "utf8").digest();
  return [buf.readInt32BE(0), buf.readInt32BE(4)];
}

/**
 * 一般任務：transaction-scoped lock（pg_try_advisory_xact_lock）。
 * 用一條專屬連線開 transaction 握住鎖，fn 內可照常使用連線池；
 * transaction 結束（成功或例外）時 Postgres 自動釋放鎖。
 * @returns 是否拿到鎖並執行；false = 另一實例正在執行，安靜跳過。
 */
export async function withXactLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const client = await getPool().connect();
  const [k1, k2] = lockKeyPair(name);
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, $2) AS locked",
      [k1, k2],
    );
    if (!rows[0]?.locked) {
      await client.query("ROLLBACK");
      return false;
    }
    try {
      await fn();
    } finally {
      await client.query("COMMIT").catch(() => undefined);
    }
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 長任務（回填、滾動校對）：專屬連線＋session lock。
 * 加解鎖用同一條連線；連線中斷時鎖自動釋放。
 */
export async function withSessionLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const client: PoolClient = await getPool().connect();
  const [k1, k2] = lockKeyPair(name);
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [k1, k2],
    );
    if (!rows[0]?.locked) return false;
    try {
      await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [k1, k2]);
    }
    return true;
  } finally {
    client.release();
  }
}
