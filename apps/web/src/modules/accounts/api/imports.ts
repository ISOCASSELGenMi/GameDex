/**
 * `/api/v1/imports/{provider}` 的 Route Handler（薄路由 app/api/v1/imports/[provider]/route.ts 以 guardModule("accounts") 包住）。
 * 動態：每個請求都讀 Cookie 與資料庫。比對交給 Next 的 after()（回應送出後執行）。
 */
import { after, connection } from "next/server";
import { handleImportRequest } from "../use-cases/import-request";

type Ctx = { params: Promise<{ provider: string }> };

const deps = {
  defer: (task: () => Promise<void>) => after(task),
  log: (message: string, extra?: Record<string, unknown>) => console.info(`[accounts] ${message}`, extra ?? {}),
};

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  await connection();
  return handleImportRequest(request, (await ctx.params).provider, deps);
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  await connection();
  return handleImportRequest(request, (await ctx.params).provider, deps);
}
