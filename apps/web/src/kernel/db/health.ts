import { getPool } from "./client";

/** /readyz 用：資料庫可連線且 migration 已執行（kernel 表存在）。 */
export async function checkDatabase(timeoutMs = 2000): Promise<{ ok: boolean; error?: string }> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs),
  );
  try {
    const query = getPool().query<{ ready: boolean }>("SELECT to_regclass('public.sync_state') IS NOT NULL AS ready");
    const { rows } = await Promise.race([query, timeout]);
    return rows[0]?.ready ? { ok: true } : { ok: false, error: "migrations not applied" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
