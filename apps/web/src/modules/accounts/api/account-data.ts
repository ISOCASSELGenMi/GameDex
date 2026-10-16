/**
 * 清單、遊玩紀錄、me/games、玩家平均的 Route Handler（薄路由 app/api/v1/{lists,play-records,me,player-ratings} 以 guardModule("accounts") 包住）。
 * 動態：每個請求都讀 Cookie 與資料庫（玩家平均例外：公開、s-maxage=300，仍需 connection() 才能讀 DB）。
 */
import { connection } from "next/server";
import * as r from "../use-cases/account-data-request";

type P<K extends string> = { params: Promise<Record<K, string>> };

export async function lists(request: Request): Promise<Response> {
  await connection();
  return r.handleLists(request);
}
export async function listsOrder(request: Request): Promise<Response> {
  await connection();
  return r.handleListsOrder(request);
}
export async function sharedList(request: Request, ctx: P<"token">): Promise<Response> {
  await connection();
  return r.handleSharedList(request, (await ctx.params).token);
}
export async function list(request: Request, ctx: P<"id">): Promise<Response> {
  await connection();
  return r.handleList(request, (await ctx.params).id);
}
export async function listGame(request: Request, ctx: P<"id" | "gameId">): Promise<Response> {
  await connection();
  const p = await ctx.params;
  return r.handleListGame(request, p.id, p.gameId);
}
export async function listGamesOrder(request: Request, ctx: P<"id">): Promise<Response> {
  await connection();
  return r.handleListGamesOrder(request, (await ctx.params).id);
}
export async function playRecords(request: Request): Promise<Response> {
  await connection();
  return r.handlePlayRecords(request);
}
export async function playStats(request: Request): Promise<Response> {
  await connection();
  return r.handlePlayStats(request);
}
export async function playRecord(request: Request, ctx: P<"id">): Promise<Response> {
  await connection();
  return r.handlePlayRecord(request, (await ctx.params).id);
}
export async function myGame(request: Request, ctx: P<"gameId">): Promise<Response> {
  await connection();
  return r.handleMyGame(request, (await ctx.params).gameId);
}
export async function playerRating(request: Request, ctx: P<"gameId">): Promise<Response> {
  await connection();
  return r.handlePlayerRating(request, (await ctx.params).gameId);
}
