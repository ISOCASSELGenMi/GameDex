// @module kernel
import { connection } from "next/server";

/** Liveness：process 活著就回 200，不碰資料庫（16 §Uptime）。 */
export async function GET(): Promise<Response> {
  await connection(); // 不預渲染，每次請求都執行
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
