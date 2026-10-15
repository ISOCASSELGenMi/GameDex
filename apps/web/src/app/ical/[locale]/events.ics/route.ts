// @module catalog
// 公開 feed：活動（08）。
import { eventsFeed } from "@/modules/catalog/api/ical";

export async function GET(request: Request, ctx: { params: Promise<{ locale: string }> }): Promise<Response> {
  return eventsFeed(request, (await ctx.params).locale);
}
