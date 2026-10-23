/** /api/v1/me/unlocks 的 Route Handler（薄路由以 guardModule("accounts") 包住）。動態：每個請求都讀 Cookie 與資料庫。 */
import { connection } from "next/server";
import { handleUnlocks } from "../use-cases/unlocks-request";

export async function unlocks(request: Request): Promise<Response> {
  await connection();
  return handleUnlocks(request);
}
