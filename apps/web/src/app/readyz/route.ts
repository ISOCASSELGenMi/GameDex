// @module kernel
import { connection } from "next/server";
import { checkDatabase } from "@/kernel/db/health";

/** Readiness：資料庫可連線且 migration 已套用才回 200。 */
export async function GET(): Promise<Response> {
  await connection();
  const db = await checkDatabase();
  return Response.json(
    { status: db.ok ? "ready" : "not_ready", checks: { database: db } },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
