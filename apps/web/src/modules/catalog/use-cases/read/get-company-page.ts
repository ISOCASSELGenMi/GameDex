import { GAME_COMPANY_ROLES, normalizePaging, type CompanyPage, type GameCompanyRole } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { getCompanyPageBySlug } from "../../repository/company-page";
import { effectiveReleaseFilterDefaults } from "./resolve-filter";

export interface GetCompanyPageInput {
  slug: string;
  locale: string;
  /** developer／publisher／porting／supporting；未給或未知值＝全部。 */
  role?: string | null;
  /** 預設 24，上限 100。 */
  limit?: number | null;
  /** 預設 0，上限 10000。 */
  offset?: number | null;
}

/**
 * 公司頁（06 §路由 /companies/[slug]）：公司資訊＋作品（依首發日期新到舊、未定最後），可依角色篩選。
 * 只列可見遊戲類型（CALENDAR_VISIBLE_GAME_TYPES）；rumored 等照列（gameStatus 讓 UI 標示）。
 * slug 不存在回 null（UI 軟 404）。逾時丟 CatalogQueryTimeoutError。
 */
export async function getCompanyPage(input: GetCompanyPageInput): Promise<CompanyPage | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 255) return null;
  const r = input.role?.trim().toLowerCase();
  const role = r && (GAME_COMPANY_ROLES as readonly string[]).includes(r) ? (r as GameCompanyRole) : null;
  const { limit, offset } = normalizePaging(input.limit, input.offset);
  const res = await getCompanyPageBySlug({
    slug,
    locale: input.locale,
    role,
    gameTypes: (await effectiveReleaseFilterDefaults()).gameTypes,
    limit,
    offset,
    resolveImage: resolveImageRef,
  });
  return res ? { company: res.company, role, roleCounts: res.roleCounts, total: res.total, works: res.works } : null;
}
