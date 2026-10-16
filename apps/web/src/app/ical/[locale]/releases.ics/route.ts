// @module catalog
// 公開 feed：未來 90 天的上市（08）。內容、標頭與快取見 catalog/api/ical.ts。
import { releasesFeed } from "@/modules/catalog/api/ical";

export async function GET(request: Request, ctx: { params: Promise<{ locale: string }> }): Promise<Response> {
  return releasesFeed(request, (await ctx.params).locale);
}
