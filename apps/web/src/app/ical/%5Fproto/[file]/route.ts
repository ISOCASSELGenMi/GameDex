// @module catalog
// 原型驗證用 feed（ICAL_PROTO_ENABLED=true 才存在；資料夾名稱的 %5F 是底線，App Router 以底線開頭的資料夾預設不是路由）。
import { protoFeedResponse } from "@/modules/catalog/api/ical-proto";

export async function GET(request: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  return protoFeedResponse(request, (await ctx.params).file);
}
