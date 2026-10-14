// @module catalog
// sitemap index（06 §SEO 與快取）：列出各分片 /sitemap/<name>。內容與快取標頭見 catalog/ui/seo/sitemap-routes.ts。
import { getLocaleConfig } from "@/kernel/locale";
import { sitemapIndexResponse } from "@/modules/catalog/ui";

export async function GET(request: Request): Promise<Response> {
  return sitemapIndexResponse(request, getLocaleConfig());
}
