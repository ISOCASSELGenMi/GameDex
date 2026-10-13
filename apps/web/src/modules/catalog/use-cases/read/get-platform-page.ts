import {
  PLATFORM_GAMES_SECTIONS,
  PLATFORM_GAMES_SORTS,
  normalizePaging,
  type PlatformPage,
} from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { getPlatformPageBySlug } from "../../repository/platform-page";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface GetPlatformPageInput {
  slug: string;
  locale: string;
  /** upcoming（預設）／recent；未知值視為預設。 */
  section?: string | null;
  /** date（預設）／popularity；未知值視為預設。 */
  sort?: string | null;
  /** 預設 24，上限 100。 */
  limit?: number | null;
  /** 預設 0，上限 10000。 */
  offset?: number | null;
  /** recent 區段的天數，預設 90。 */
  recentDays?: number;
  /** 地區偏好（聚合挑代表上市列用，與月曆相同）；未給或無效＝DEFAULT_REGION_PREF。 */
  region?: string | null;
  /** 「今天」（取 UTC 日期）；預設現在。 */
  today?: Date;
}

/**
 * 平台頁（06 §路由 /platforms/[slug]）：平台資訊＋platform_release_dates＋該平台即將上市／近期的遊戲。
 * 遊戲清單＝聚合規則（與月曆同一份）以本平台篩選後的卡片：一款遊戲同平台有多個階段（例如搶先體驗＋正式版）時
 * 會出現多筆。上市列套用月曆預設（可見階段、可見遊戲類型、scheduled／delayed／released；rumored 遊戲不列）。
 * slug 不存在或是 mobile 平台回 null（UI 軟 404）。逾時丟 CatalogQueryTimeoutError。
 */
export async function getPlatformPage(input: GetPlatformPageInput): Promise<PlatformPage | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 100) return null;
  const section = pick(input.section, PLATFORM_GAMES_SECTIONS, "upcoming");
  const sort = pick(input.sort, PLATFORM_GAMES_SORTS, "date");
  const { limit, offset } = normalizePaging(input.limit, input.offset);
  const { filter } = await resolveFilterSlugs({});
  const res = await getPlatformPageBySlug({
    slug,
    locale: input.locale,
    today: (input.today ?? new Date()).toISOString().slice(0, 10),
    section,
    sort,
    recentDays: input.recentDays,
    limit,
    offset,
    filter,
    regionPref: resolveRegionPref(input.region),
    resolveImage: resolveImageRef,
  });
  return res ? { platform: res.platform, section, sort, games: res.games } : null;
}

function pick<T extends string>(v: string | null | undefined, allowed: readonly T[], fallback: T): T {
  const s = v?.trim().toLowerCase();
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}
