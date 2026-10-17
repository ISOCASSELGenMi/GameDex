import type { PlatformKindGroup } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { listPlatformGroups } from "../../repository/platform-page";

export interface ListPlatformsInput {
  /** 平台名稱是專有名詞（原文）；保留參數以便日後依語系排序。 */
  locale: string;
  /** 「近期事件數」的中心日（UTC）；預設今天。 */
  today?: Date;
}

/**
 * 平台總覽（06 §路由 /platforms）：依 kind 分組（console → handheld → pc → arcade → other）；hybrid（Switch 系列）同時列在 console 與 handheld。
 * mobile 不列（P35）；other 列在最後一組（UI 可預設收合）。組內常用平台在前（與篩選面板同一 isCommonPlatform 規則）。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function listPlatforms(input: ListPlatformsInput): Promise<PlatformKindGroup[]> {
  void input.locale;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  return listPlatformGroups(today, resolveImageRef);
}
