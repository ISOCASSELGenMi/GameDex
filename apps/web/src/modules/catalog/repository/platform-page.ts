/**
 * 平台總覽與平台頁（06 §路由，Phase 3b）。mobile 平台不顯示（P35）：總覽不列、平台頁視為不存在。
 * 平台頁的遊戲清單以「該平台」的 release_events 為準（release_events_date_platform_idx），
 * 不用 games.firstReleaseDate（移植版的首發日是別的平台）。之後可改用通用瀏覽查詢（browse-games）。
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import type {
  DatePrecision,
  ImageResolver,
  IsoDate,
  PagedList,
  PlatformGameItem,
  PlatformGamesSection,
  PlatformGamesSort,
  PlatformInfo,
  PlatformKind,
  PlatformKindGroup,
  PlatformListItem,
  PlatformStatus,
  ReleaseStage,
} from "../domain/entities";
import { isCommonPlatform } from "./filter-options";
import { summaryColumns, toSummary, type SummaryRow } from "./game-detail";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

/** 總覽的分組順序（mobile 不列；other 放最後，UI 可預設收合）。 */
export const PLATFORM_OVERVIEW_KIND_ORDER: readonly PlatformKind[] = ["console", "hybrid", "handheld", "pc", "arcade", "other"];

interface PlatformRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  abbreviation: string | null;
  kind: PlatformKind;
  generation: number | null;
  status: PlatformStatus;
  logo_url: string | null;
  family_slug: string | null;
  family_name: string | null;
  recent: number;
}

const platformSelect = (today: IsoDate) => sql`
  SELECT pl.id, pl.slug, pl.name, pl.abbreviation, pl.kind, pl.generation, pl.status, pl.logo_url,
    pf.slug AS family_slug, pf.name AS family_name,
    COALESCE((
      SELECT count(*) FROM release_events r
      WHERE r.platform_id = pl.id AND r.release_date BETWEEN (${today}::date - 365) AND (${today}::date + 365)
    ), 0)::int AS recent
  FROM platforms pl LEFT JOIN platform_families pf ON pf.id = pl.family_id`;

function toListItem(r: PlatformRow): PlatformListItem {
  return {
    slug: r.slug,
    name: r.name,
    abbreviation: r.abbreviation,
    kind: r.kind,
    generation: r.generation,
    family: r.family_slug && r.family_name ? { slug: r.family_slug, name: r.family_name } : null,
    status: r.status,
    logoUrl: r.logo_url,
    recentReleaseCount: r.recent,
    isCommon: isCommonPlatform(r.kind, r.recent),
  };
}

/** 組內排序：常用在前（依近期事件數多到少），其餘世代新到舊、名稱。 */
export function groupPlatformsByKind(items: readonly PlatformListItem[]): PlatformKindGroup[] {
  return PLATFORM_OVERVIEW_KIND_ORDER.map((kind) => ({
    kind,
    platforms: items
      .filter((p) => p.kind === kind)
      .sort(
        (a, b) =>
          Number(b.isCommon) - Number(a.isCommon) ||
          (a.isCommon ? b.recentReleaseCount - a.recentReleaseCount : 0) ||
          (b.generation ?? -1) - (a.generation ?? -1) ||
          a.name.localeCompare(b.name, "en") ||
          a.slug.localeCompare(b.slug),
      ),
  })).filter((g) => g.platforms.length > 0);
}

/** 平台總覽（不含 mobile），依 kind 分組。@param today UTC 日期（近期事件數的中心）。 */
export async function listPlatformGroups(today: IsoDate, opts: ReadOptions = {}): Promise<PlatformKindGroup[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<PlatformRow>(sql`${platformSelect(today)} WHERE pl.kind <> 'mobile'`),
    opts,
  );
  return groupPlatformsByKind(res.rows.map(toListItem));
}

export interface PlatformPageQuery {
  slug: string;
  locale: string;
  /** UTC 日期：upcoming ≥ today；recent ∈ [today − recentDays, today)。 */
  today: IsoDate;
  section: PlatformGamesSection;
  sort: PlatformGamesSort;
  /** 預設 90。 */
  recentDays?: number;
  limit: number;
  offset: number;
  /** 上市列的階段／遊戲類型／狀態（通常是月曆預設值）。rumored 遊戲一律不列。 */
  stages: readonly string[];
  gameTypes: readonly string[];
  statuses: readonly string[];
  resolveImage: ImageResolver;
}

interface PlatformGameRow extends SummaryRow {
  game_status: string | null;
  rep_date: IsoDate;
  rep_precision: DatePrecision;
  rep_stage: ReleaseStage;
}

/** 平台頁；slug 不存在或是 mobile 平台回 null。 */
export async function getPlatformPageBySlug(
  q: PlatformPageQuery,
  opts: ReadOptions = {},
): Promise<{ platform: PlatformInfo; games: PagedList<PlatformGameItem> } | null> {
  return withReadTimeout((tx) => readPlatformPage(tx, q), opts);
}

async function readPlatformPage(
  tx: DbOrTx,
  q: PlatformPageQuery,
): Promise<{ platform: PlatformInfo; games: PagedList<PlatformGameItem> } | null> {
  const res = await tx.execute<PlatformRow & { alternative_name: string | null; summary: string | null; discontinued_on: IsoDate | null }>(sql`
    SELECT x.*, p2.alternative_name, p2.summary, p2.discontinued_on::text AS discontinued_on
    FROM (${platformSelect(q.today)} WHERE pl.slug = ${q.slug} AND pl.kind <> 'mobile' LIMIT 1) x
    JOIN platforms p2 ON p2.id = x.id
  `);
  const p = res.rows[0];
  if (!p) return null;

  const datesRes = await tx.execute<{ code: string; release_date: IsoDate | null; precision: DatePrecision }>(sql`
    SELECT rg.code, d.release_date::text AS release_date, d.precision
    FROM platform_release_dates d JOIN regions rg ON rg.id = d.region_id
    WHERE d.platform_id = ${p.id}
    ORDER BY d.release_date ASC NULLS LAST, rg.code ASC
  `);

  const upcoming = q.section === "upcoming";
  const recentDays = Math.max(1, Math.floor(q.recentDays ?? 90));
  // 期間結束日：month 精度的代表日是當月 1 日，要算到月底（本月未定日的遊戲仍算「即將上市」）；
  // quarter／year 的代表日已是期間最後一天。原欄位的寬範圍條件讓查詢仍走 (release_date, platform_id) 索引。
  const periodEnd = sql`(CASE WHEN r.precision = 'month'
      THEN (date_trunc('month', r.release_date) + interval '1 month - 1 day')::date ELSE r.release_date END)`;
  const dateCond = upcoming
    ? sql`r.release_date >= (${q.today}::date - 31) AND ${periodEnd} >= ${q.today}::date`
    : sql`r.release_date >= (${q.today}::date - ${recentDays}::int - 31) AND r.release_date < ${q.today}::date
        AND ${periodEnd} >= (${q.today}::date - ${recentDays}::int) AND ${periodEnd} < ${q.today}::date`;
  // 每款遊戲挑一筆代表列：upcoming 取最早、recent 取最晚；同日依精度（day 優先）、id
  const pickOrder = upcoming ? sql`r.release_date ASC` : sql`r.release_date DESC`;
  const outerOrder =
    q.sort === "popularity"
      ? upcoming
        ? sql`g.popularity_score DESC, c.release_date ASC, g.name ASC, g.id ASC`
        : sql`g.popularity_score DESC, c.release_date DESC, g.name ASC, g.id ASC`
      : upcoming
        ? sql`c.release_date ASC, g.popularity_score DESC, g.name ASC, g.id ASC`
        : sql`c.release_date DESC, g.popularity_score DESC, g.name ASC, g.id ASC`;

  const gamesRes = await tx.execute<PlatformGameRow>(sql`
    WITH c AS (
      SELECT DISTINCT ON (r.game_id) r.game_id, r.release_date, r.precision, r.release_stage
      FROM release_events r
      WHERE r.platform_id = ${p.id} AND ${dateCond}
        AND r.precision <> 'tbd'
        AND r.release_stage::text = ANY(${pgArray(q.stages)}::text[])
        AND r.status::text = ANY(${pgArray(q.statuses)}::text[])
      ORDER BY r.game_id, ${pickOrder}, (r.precision = 'day') DESC, r.id ASC
    )
    SELECT ${summaryColumns("g", q.locale)}, g.game_status,
      c.release_date::text AS rep_date, c.precision AS rep_precision, c.release_stage AS rep_stage
    FROM c JOIN games g ON g.id = c.game_id
    WHERE COALESCE(g.game_type, 'main_game') = ANY(${pgArray(q.gameTypes)}::text[])
      AND g.game_status IS DISTINCT FROM 'rumored'
    ORDER BY ${outerOrder}
    LIMIT ${q.limit + 1} OFFSET ${q.offset}
  `);
  const rows = gamesRes.rows.slice(0, q.limit);

  return {
    platform: {
      ...toListItem(p),
      alternativeName: p.alternative_name,
      summary: p.summary,
      discontinuedOn: p.discontinued_on,
      releaseDates: datesRes.rows.map((d) => ({ regionCode: d.code, date: d.release_date, precision: d.precision })),
    },
    games: {
      items: rows.map((r) => ({
        ...toSummary(r, q.resolveImage),
        gameStatus: r.game_status,
        date: r.rep_date,
        precision: r.rep_precision,
        stage: r.rep_stage,
      })),
      limit: q.limit,
      offset: q.offset,
      hasMore: gamesRes.rows.length > q.limit,
    },
  };
}
