// @module catalog
// 單一遊戲「下載 .ics」（/ical/{locale}/game/{slug}.ics，Content-Disposition: attachment）。
import { gameFeed } from "@/modules/catalog/api/ical";

export async function GET(request: Request, ctx: { params: Promise<{ locale: string; file: string }> }): Promise<Response> {
  const { locale, file } = await ctx.params;
  return gameFeed(request, locale, file);
}
