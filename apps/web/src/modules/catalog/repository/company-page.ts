/** 公司頁（06 §路由，Phase 3b）：公司資訊＋作品（game_companies，依角色）。之後可改用通用瀏覽查詢（browse-games）。 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import {
  GAME_COMPANY_ROLES,
  type CompanyInfo,
  type CompanyWork,
  type GameCompanyRole,
  type ImageResolver,
  type PagedList,
} from "../domain/entities";
import { summaryColumns, toSummary, type SummaryRow } from "./game-detail";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export interface CompanyPageQuery {
  slug: string;
  locale: string;
  /** null＝全部角色。 */
  role: GameCompanyRole | null;
  /** 只列這些遊戲類型（通常是 CALENDAR_VISIBLE_GAME_TYPES，避免 DLC 洗版）。 */
  gameTypes: readonly string[];
  limit: number;
  offset: number;
  resolveImage: ImageResolver;
}

export interface CompanyPageResult {
  company: CompanyInfo;
  roleCounts: Record<GameCompanyRole, number>;
  total: number;
  works: PagedList<CompanyWork>;
}

const ROLE_ORDER = new Map(GAME_COMPANY_ROLES.map((r, i) => [r, i]));

/** slug 不存在回 null。 */
export async function getCompanyPageBySlug(q: CompanyPageQuery, opts: ReadOptions = {}): Promise<CompanyPageResult | null> {
  return withReadTimeout((tx) => readCompanyPage(tx, q), opts);
}

async function readCompanyPage(tx: DbOrTx, q: CompanyPageQuery): Promise<CompanyPageResult | null> {
  const cRes = await tx.execute<{ id: number; slug: string; name: string; logo_url: string | null; website_url: string | null }>(sql`
    SELECT c.id, c.slug, c.name, c.logo_url, c.website_url FROM companies c WHERE c.slug = ${q.slug} LIMIT 1
  `);
  const c = cRes.rows[0];
  if (!c) return null;
  const typeCond = sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(q.gameTypes)}::text[])`;

  const countRes = await tx.execute<{ role: GameCompanyRole | null; n: number }>(sql`
    SELECT gc.role, count(DISTINCT gc.game_id)::int AS n
    FROM game_companies gc JOIN games g ON g.id = gc.game_id
    WHERE gc.company_id = ${c.id} AND ${typeCond}
    GROUP BY GROUPING SETS ((gc.role), ())
  `);
  const roleCounts = Object.fromEntries(GAME_COMPANY_ROLES.map((r) => [r, 0])) as Record<GameCompanyRole, number>;
  let total = 0;
  for (const r of countRes.rows) {
    if (r.role == null) total = r.n;
    else roleCounts[r.role] = r.n;
  }

  const roleCond = q.role ? sql`AND bool_or(gc.role = ${q.role})` : sql``;
  const worksRes = await tx.execute<SummaryRow & { game_status: string | null; roles: GameCompanyRole[] }>(sql`
    SELECT ${summaryColumns("g", q.locale)}, g.game_status, array_agg(DISTINCT gc.role::text) AS roles
    FROM game_companies gc JOIN games g ON g.id = gc.game_id
    WHERE gc.company_id = ${c.id} AND ${typeCond}
    GROUP BY g.id
    HAVING TRUE ${roleCond}
    ORDER BY g.first_release_date DESC NULLS LAST, g.name ASC, g.id ASC
    LIMIT ${q.limit + 1} OFFSET ${q.offset}
  `);
  const rows = worksRes.rows.slice(0, q.limit);
  return {
    company: { slug: c.slug, name: c.name, logo: q.resolveImage(c.logo_url, "logo"), logoUrl: c.logo_url, websiteUrl: c.website_url },
    roleCounts,
    total,
    works: {
      items: rows.map((r) => ({
        ...toSummary(r, q.resolveImage),
        gameStatus: r.game_status,
        roles: parsePgArray(r.roles).sort((a, b) => (ROLE_ORDER.get(a) ?? 99) - (ROLE_ORDER.get(b) ?? 99)),
      })),
      limit: q.limit,
      offset: q.offset,
      hasMore: worksRes.rows.length > q.limit,
    },
  };
}

/** node-postgres 對 text[] 回 JS 陣列；保險起見也接受 '{a,b}' 字串。 */
function parsePgArray<T extends string>(v: T[] | string | null): T[] {
  if (v == null) return [];
  if (Array.isArray(v)) return [...v];
  return v.replace(/^\{|\}$/g, "").split(",").filter(Boolean) as T[];
}
