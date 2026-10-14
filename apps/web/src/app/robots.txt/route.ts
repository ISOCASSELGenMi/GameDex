// @module catalog
// robots.txt：Sitemap 指向 index；擋 /api、/internal、私人 feed。
import { robotsResponse } from "@/modules/catalog/ui";

export async function GET(request: Request): Promise<Response> {
  return robotsResponse(request);
}
