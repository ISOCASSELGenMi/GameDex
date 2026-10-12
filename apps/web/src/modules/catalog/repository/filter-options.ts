/** 篩選選項與 slug → id 解析（06 §篩選）。 */
import { sql } from "drizzle-orm";
import type { IsoDate, PlatformKind, PlatformOption, TaxonomyItem } from "../domain/entities";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

/** 近期（今天前後 365 天）上市事件數達此值即視為常用平台。2026-10 實測：Win 5.8 萬、Switch 2 約 860、Playdate 約 420、Meta Quest 3 約 260。 */
export const COMMON_PLATFORM_MIN_RECENT_RELEASES = 200;

/**
 * 常用平台：近期事件數達門檻，且不是 kind='other'（browser、steam-vr 等不算，使用者 2026-10-13 決定）。
 */
export function isCommonPlatform(kind: PlatformKind, recentReleaseCount: number): boolean {
  return kind !== "other" && kind !== "mobile" && recentReleaseCount >= COMMON_PLATFORM_MIN_RECENT_RELEASES;
}

interface PlatformRow extends Record<string, unknown> {
  slug: string;
  name: string;
  abbreviation: string | null;
  kind: PlatformKind;
  generation: number | null;
  recent: number;
}

const KIND_ORDER: readonly PlatformKind[] = ["console", "hybrid", "handheld", "pc", "arcade", "other", "mobile"];

/**
 * 平台選項（不含 mobile）。常用平台在前（依近期事件數多到少），其餘依種類、世代新到舊、名稱。
 * @param today UTC 日期，近期區間的中心
 */
export async function listPlatformOptions(today: IsoDate, opts: ReadOptions = {}): Promise<PlatformOption[]> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<PlatformRow>(sql`
        SELECT pl.slug, pl.name, pl.abbreviation, pl.kind, pl.generation, COALESCE(c.n, 0)::int AS recent
        FROM platforms pl
        LEFT JOIN (
          SELECT r.platform_id, count(*) AS n FROM release_events r
          WHERE r.release_date BETWEEN (${today}::date - 365) AND (${today}::date + 365)
          GROUP BY r.platform_id
        ) c ON c.platform_id = pl.id
        WHERE pl.kind <> 'mobile'
      `),
    opts,
  );
  const options = res.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    abbreviation: r.abbreviation,
    kind: r.kind,
    generation: r.generation,
    recentReleaseCount: r.recent,
    isCommon: isCommonPlatform(r.kind, r.recent),
  }));
  return options.sort(
    (a, b) =>
      Number(b.isCommon) - Number(a.isCommon) ||
      (a.isCommon ? b.recentReleaseCount - a.recentReleaseCount : 0) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (b.generation ?? -1) - (a.generation ?? -1) ||
      a.name.localeCompare(b.name, "en"),
  );
}

export async function listGenreOptions(opts: ReadOptions = {}): Promise<TaxonomyItem[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<{ slug: string; name: string }>(sql`SELECT slug, name FROM genres ORDER BY name, id`),
    opts,
  );
  return res.rows.map((r) => ({ slug: r.slug, name: r.name }));
}

/** slug → id；不存在的 slug 不在結果內。mobile 平台視為不存在（不顯示，P35）。 */
export async function lookupFilterSlugs(
  q: { platformSlugs: readonly string[]; genreSlugs: readonly string[] },
  opts: ReadOptions = {},
): Promise<{ platforms: Map<string, number>; genres: Map<string, number> }> {
  const platforms = new Map<string, number>();
  const genres = new Map<string, number>();
  if (q.platformSlugs.length === 0 && q.genreSlugs.length === 0) return { platforms, genres };
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ dim: "platform" | "genre"; slug: string; id: number }>(sql`
        SELECT 'platform' AS dim, slug, id FROM platforms
        WHERE slug = ANY(${pgArray(q.platformSlugs)}::text[]) AND kind <> 'mobile'
        UNION ALL
        SELECT 'genre' AS dim, slug, id FROM genres WHERE slug = ANY(${pgArray(q.genreSlugs)}::text[])
      `),
    opts,
  );
  for (const r of res.rows) (r.dim === "platform" ? platforms : genres).set(r.slug, r.id);
  return { platforms, genres };
}
