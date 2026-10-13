/**
 * 平台總覽與平台頁（06 §路由，Phase 3b）。mobile 平台不顯示（P35）：總覽不列、平台頁視為不存在。
 * 平台頁的遊戲清單以「該平台」的上市列為準，不用 games.firstReleaseDate（移植版的首發日是別的平台）。
 * 代表上市列的挑選**直接用聚合規則**（release-aggregate.ts 的 buildAggregateCardsQuery，platform 篩選＝本平台），
 * 不另寫挑選邏輯（原則五）：地區偏好、manual 優先、有日期優先……與月曆完全一致；一張卡＝(遊戲, 階段)。
 * upcoming／recent 用聚合的上市狀態篩選（filter.releaseStates）判斷，這裡只多加 recent 的天數下限。
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import type {
  DatePrecision,
  ImageResolver,
  IsoDate,
  PagedList,
  RegionCode,
  ResolvedReleaseFilter,
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
import { withReadTimeout, type ReadOptions } from "./read-tx";
import { buildAggregateCardsQuery } from "./release-aggregate";

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

function toListItem(r: PlatformRow, resolveImage: ImageResolver): PlatformListItem {
  return {
    slug: r.slug,
    name: r.name,
    abbreviation: r.abbreviation,
    kind: r.kind,
    generation: r.generation,
    family: r.family_slug && r.family_name ? { slug: r.family_slug, name: r.family_name } : null,
    status: r.status,
    logo: resolveImage(r.logo_url, "logo"),
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

/**
 * 平台總覽（不含 mobile），依 kind 分組。@param today UTC 日期（近期事件數的中心）。
 * @param resolveImage logo 網址 → ImageRef（Provider 實作，由 Use Case 傳入）。
 */
export async function listPlatformGroups(
  today: IsoDate,
  resolveImage: ImageResolver,
  opts: ReadOptions = {},
): Promise<PlatformKindGroup[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<PlatformRow>(sql`${platformSelect(today)} WHERE pl.kind <> 'mobile'`),
    opts,
  );
  return groupPlatformsByKind(res.rows.map((r) => toListItem(r, resolveImage)));
}

export interface PlatformPageQuery {
  slug: string;
  locale: string;
  /** UTC 日期：upcoming／released 的判斷基準（聚合的 releaseStates）。 */
  today: IsoDate;
  section: PlatformGamesSection;
  sort: PlatformGamesSort;
  /** 預設 90。 */
  recentDays?: number;
  limit: number;
  offset: number;
  /**
   * 基本篩選（通常是月曆預設：可見階段、可見遊戲類型、scheduled／delayed／released、不含 rumored、含 removed）。
   * platformIds 與 releaseStates 會被這裡覆寫（本平台；upcoming／released）。
   */
  filter: ResolvedReleaseFilter;
  /** 聚合的地區偏好。 */
  regionPref: RegionCode;
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
  // 代表日期的寬範圍：month 精度的代表日是當月 1 日，往前多 31 天才不會漏掉「本月未定日」；
  // 是否 upcoming／released 由聚合的 releaseStates 以期間結束日判斷（與月曆、時間軸同一份規則）。
  const cards = buildAggregateCardsQuery({
    from: upcoming ? addDays(q.today, -31) : addDays(q.today, -(recentDays + 31)),
    to: upcoming ? null : q.today,
    filter: { ...q.filter, platformIds: [p.id], releaseStates: [upcoming ? "upcoming" : "released"] },
    regionPref: q.regionPref,
    locale: q.locale,
    today: q.today,
  });
  // recent 只列期間結束日在今天前 recentDays 天內的（quarter／year 的代表日已是期間最後一天）
  const recentCond = upcoming
    ? sql``
    : sql`WHERE (CASE WHEN c.precision = 'month'
        THEN (c.release_date::date + interval '1 month' - interval '1 day')::date
        ELSE c.release_date::date END) >= (${q.today}::date - ${recentDays}::int)`;
  const dateDir = upcoming ? sql`ASC` : sql`DESC`;
  const outerOrder =
    q.sort === "popularity"
      ? sql`g.popularity_score DESC, c.release_date ${dateDir}, g.name ASC, g.id ASC, c.release_stage ASC`
      : sql`c.release_date ${dateDir}, g.popularity_score DESC, g.name ASC, g.id ASC, c.release_stage ASC`;

  const gamesRes = await tx.execute<PlatformGameRow>(sql`
    SELECT ${summaryColumns("g", q.locale)}, g.game_status,
      c.release_date AS rep_date, c.precision AS rep_precision, c.release_stage AS rep_stage
    FROM (${cards}) c JOIN games g ON g.id = c.game_id
    ${recentCond}
    ORDER BY ${outerOrder}
    LIMIT ${q.limit + 1} OFFSET ${q.offset}
  `);
  const rows = gamesRes.rows.slice(0, q.limit);

  return {
    platform: {
      ...toListItem(p, q.resolveImage),
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

/** YYYY-MM-DD 加減天數（UTC）。 */
function addDays(d: IsoDate, days: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
