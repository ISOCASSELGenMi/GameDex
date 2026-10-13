import type { EventDetail } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { getEventDetailBySlug } from "../../repository/event-pages";

export interface GetEventDetailInput {
  slug: string;
  locale: string;
  /** 「現在」（timeStatus 的基準）；測試用，預設資料庫 now()。 */
  now?: Date;
}

/**
 * 活動詳情（06 §活動 /events/[slug]）：時間（startTime NULL＝時間未定）、直播連結、主辦、相關遊戲（event_games，
 * 依熱度，上限 100，總數見 gameCount）、同系列歷屆（event_series，上限 50）。slug 不存在回 null（UI 軟 404）。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getEventDetail(input: GetEventDetailInput): Promise<EventDetail | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 255) return null;
  return getEventDetailBySlug({ slug, locale: input.locale, now: input.now, resolveImage: resolveImageRef });
}
