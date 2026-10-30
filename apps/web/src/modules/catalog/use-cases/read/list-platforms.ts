import { DEFAULT_PLATFORM_OVERVIEW_DIR, PLATFORM_OVERVIEW_DIRS, PLATFORM_OVERVIEW_SORTS } from "../../domain/entities";
import type { PlatformKindGroup, PlatformOverviewDir, PlatformOverviewOrder, PlatformOverviewSort } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { listPlatformGroups } from "../../repository/platform-page";

export interface ListPlatformsInput {
  /** 平台名稱是專有名詞（原文）；保留參數以便日後依語系排序。 */
  locale: string;
  /** 「近期事件數」的中心日（UTC）；預設今天。 */
  today?: Date;
  /**
   * 排序（平台總覽 `/platforms?sort=release&dir=asc|desc`）：依平台發售日（platform_release_dates 最早一筆有日期的），沒有日期的永遠最後。
   * 不給＝原本的順序（常用在前）。不合法的值退回 release／desc。
   */
  order?: { sort?: string | null; dir?: string | null };
}

/** 平台總覽排序參數的正規化（不合法退回 release／desc）。 */
export function normalizePlatformOverviewOrder(order: { sort?: string | null; dir?: string | null } = {}): PlatformOverviewOrder {
  return {
    sort: (PLATFORM_OVERVIEW_SORTS as readonly string[]).includes(order.sort ?? "") ? (order.sort as PlatformOverviewSort) : PLATFORM_OVERVIEW_SORTS[0],
    dir: (PLATFORM_OVERVIEW_DIRS as readonly string[]).includes(order.dir ?? "") ? (order.dir as PlatformOverviewDir) : DEFAULT_PLATFORM_OVERVIEW_DIR,
  };
}

/**
 * 平台總覽（06 §路由 /platforms）：依 kind 分組（console → handheld → pc → arcade → other）；hybrid（Switch 系列）同時列在 console 與 handheld。
 * mobile 不列（P35）；other 列在最後一組（UI 可預設收合）。組內預設常用平台在前（與篩選面板同一 isCommonPlatform 規則）；給 order 時依平台發售日。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function listPlatforms(input: ListPlatformsInput): Promise<PlatformKindGroup[]> {
  void input.locale;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  return listPlatformGroups(today, resolveImageRef, {}, input.order ? normalizePlatformOverviewOrder(input.order) : undefined);
}
