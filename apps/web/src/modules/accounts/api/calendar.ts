/**
 * 私人 iCal 訂閱的 Route Handler（薄路由 app/api/v1/calendar/** 與 app/ical/u/** 以 guardModule("accounts") 包住）。
 */
import { connection } from "next/server";
import * as r from "../use-cases/feed-request";

type P<K extends string> = { params: Promise<Record<K, string>> };

export async function feeds(request: Request): Promise<Response> {
  await connection();
  return r.handleFeeds(request);
}
export async function feed(request: Request, ctx: P<"id">): Promise<Response> {
  await connection();
  return r.handleFeed(request, (await ctx.params).id);
}
export async function feedRotate(request: Request, ctx: P<"id">): Promise<Response> {
  await connection();
  return r.handleFeedRotate(request, (await ctx.params).id);
}
export async function privateIcs(request: Request, ctx: P<"file">): Promise<Response> {
  await connection();
  return r.handlePrivateIcs(request, (await ctx.params).file);
}
