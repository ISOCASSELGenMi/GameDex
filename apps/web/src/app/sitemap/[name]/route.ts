// @module catalog
// sitemap 分片：pages.xml、games-<n>.xml、companies-<n>.xml、franchises-<n>.xml（每片 ≤ 50,000 URL）。
import { getLocaleConfig } from "@/kernel/locale";
import { sitemapShardResponse } from "@/modules/catalog/ui";

export async function GET(request: Request, ctx: RouteContext<"/sitemap/[name]">): Promise<Response> {
  const { name } = await ctx.params;
  return sitemapShardResponse(request, name, getLocaleConfig());
}
