/**
 * 追蹤、me/follows/state、me/games 的 Route Handler（薄路由 app/api/v1/{follows,me} 以 guardModule("accounts") 包住）。
 * 動態：每個請求都讀 Cookie 與資料庫（公開的追蹤人數例外：public, s-maxage=300，仍需 connection() 才能讀 DB）。
 */
import { connection } from "next/server";
import * as r from "../use-cases/follow-request";

type P<K extends string> = { params: Promise<Record<K, string>> };

export async function follows(request: Request): Promise<Response> {
  await connection();
  return r.handleFollows(request);
}
export async function followTarget(request: Request, ctx: P<"targetType" | "targetId">): Promise<Response> {
  await connection();
  const p = await ctx.params;
  return r.handleFollowTarget(request, p.targetType, p.targetId);
}
export async function followCount(request: Request, ctx: P<"targetType" | "targetId">): Promise<Response> {
  await connection();
  const p = await ctx.params;
  return r.handleFollowCount(request, p.targetType, p.targetId);
}
export async function followState(request: Request): Promise<Response> {
  await connection();
  return r.handleFollowState(request);
}
export async function myGames(request: Request): Promise<Response> {
  await connection();
  return r.handleMyGames(request);
}
