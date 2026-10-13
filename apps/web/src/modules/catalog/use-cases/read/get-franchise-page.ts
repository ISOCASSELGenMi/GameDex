import { FRANCHISE_KINDS, normalizePaging, type FranchiseKind, type FranchisePage } from "../../domain/entities";
import { resolveImageRef } from "../../providers/image-ref";
import { getFranchisePageBySlug } from "../../repository/franchise-page";
import { releaseFilterDefaults } from "./resolve-filter";

export interface GetFranchisePageInput {
  slug: string;
  locale: string;
  /** franchise／collection；未給或未知值＝franchise 優先。給了但該 kind 不存在 → null。 */
  kind?: string | null;
  /** 預設 24，上限 100。 */
  limit?: number | null;
  /** 預設 0，上限 10000。 */
  offset?: number | null;
}

/**
 * 系列頁（06 §路由 /franchises/[slug]）：系列作品依首發日期舊到新（未定最後）。
 * 只列可見遊戲類型（CALENDAR_VISIBLE_GAME_TYPES）。slug 不存在回 null（UI 軟 404）。逾時丟 CatalogQueryTimeoutError。
 */
export async function getFranchisePage(input: GetFranchisePageInput): Promise<FranchisePage | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 255) return null;
  const k = input.kind?.trim().toLowerCase();
  const kind = k && (FRANCHISE_KINDS as readonly string[]).includes(k) ? (k as FranchiseKind) : null;
  const { limit, offset } = normalizePaging(input.limit, input.offset);
  return getFranchisePageBySlug({
    slug,
    kind,
    locale: input.locale,
    gameTypes: releaseFilterDefaults().gameTypes,
    limit,
    offset,
    resolveImage: resolveImageRef,
  });
}
