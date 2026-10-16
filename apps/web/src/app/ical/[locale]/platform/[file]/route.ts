// @module catalog
// 公開 feed：單一平台（/ical/{locale}/platform/{slug}.ics；Next 不支援 `[slug].ics` 這種部分動態區段，所以檔名整段進來再去掉副檔名）。
import { platformFeed } from "@/modules/catalog/api/ical";

export async function GET(request: Request, ctx: { params: Promise<{ locale: string; file: string }> }): Promise<Response> {
  const { locale, file } = await ctx.params;
  return platformFeed(request, locale, file);
}
