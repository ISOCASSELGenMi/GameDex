/**
 * 系列頁（06 §路由，Phase 3b）：系列作品依首發日排序。
 * franchises.slug 不唯一：IGDB 的 franchise 與 collection 是不同 id 空間，同名時 slug 相同（2026-10 本機 968 組）。
 * 未指定 kind 時優先 franchise，另外回報同 slug 的其他 kind 供 UI 切換。
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import {
  FRANCHISE_KINDS,
  type FranchiseInfo,
  type FranchiseKind,
  type GameListItem,
  type ImageResolver,
  type PagedList,
} from "../domain/entities";
import { summaryColumns, toSummary, type SummaryRow } from "./game-detail";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export interface FranchisePageQuery {
  slug: string;
  /** 未給＝依 FRANCHISE_KINDS 順序挑第一個存在的（franchise 優先）。 */
  kind?: FranchiseKind | null;
  locale: string;
  /** 只列這些遊戲類型（通常是 CALENDAR_VISIBLE_GAME_TYPES）。 */
  gameTypes: readonly string[];
  limit: number;
  offset: number;
  resolveImage: ImageResolver;
}

export interface FranchisePageResult {
  franchise: FranchiseInfo;
  total: number;
  games: PagedList<GameListItem>;
}

/** slug（＋kind）不存在回 null。 */
export async function getFranchisePageBySlug(q: FranchisePageQuery, opts: ReadOptions = {}): Promise<FranchisePageResult | null> {
  return withReadTimeout((tx) => readFranchisePage(tx, q), opts);
}

async function readFranchisePage(tx: DbOrTx, q: FranchisePageQuery): Promise<FranchisePageResult | null> {
  const fRes = await tx.execute<{ id: number; slug: string; name: string; kind: FranchiseKind }>(sql`
    SELECT f.id, f.slug, f.name, f.kind FROM franchises f WHERE f.slug = ${q.slug} ORDER BY f.id
  `);
  if (fRes.rows.length === 0) return null;
  const kindRank = (k: FranchiseKind) => FRANCHISE_KINDS.indexOf(k);
  const candidates = [...fRes.rows].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.id - b.id);
  const f = q.kind ? candidates.find((r) => r.kind === q.kind) : candidates[0];
  if (!f) return null;
  const otherKinds = FRANCHISE_KINDS.filter((k) => k !== f.kind && candidates.some((r) => r.kind === k));

  const typeCond = sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(q.gameTypes)}::text[])`;
  const countRes = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM game_franchises gf JOIN games g ON g.id = gf.game_id
    WHERE gf.franchise_id = ${f.id} AND ${typeCond}
  `);
  const gamesRes = await tx.execute<SummaryRow & { game_status: string | null }>(sql`
    SELECT ${summaryColumns("g", q.locale)}, g.game_status
    FROM game_franchises gf JOIN games g ON g.id = gf.game_id
    WHERE gf.franchise_id = ${f.id} AND ${typeCond}
    ORDER BY g.first_release_date ASC NULLS LAST, g.name ASC, g.id ASC
    LIMIT ${q.limit + 1} OFFSET ${q.offset}
  `);
  const rows = gamesRes.rows.slice(0, q.limit);
  return {
    franchise: { slug: f.slug, name: f.name, kind: f.kind, otherKinds },
    total: countRes.rows[0]?.n ?? 0,
    games: {
      items: rows.map((r) => ({ ...toSummary(r, q.resolveImage), gameStatus: r.game_status })),
      limit: q.limit,
      offset: q.offset,
      hasMore: gamesRes.rows.length > q.limit,
    },
  };
}
