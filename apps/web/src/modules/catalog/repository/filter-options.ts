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

/** 主題選項（依原文名稱）。 */
export async function listThemeOptions(opts: ReadOptions = {}): Promise<TaxonomyItem[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<{ slug: string; name: string }>(sql`SELECT slug, name FROM themes ORDER BY name, id`),
    opts,
  );
  return res.rows.map((r) => ({ slug: r.slug, name: r.name }));
}

/** regions.code（WW 在前，其餘依 code）。 */
export async function listRegionCodes(opts: ReadOptions = {}): Promise<string[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<{ code: string }>(sql`SELECT code FROM regions ORDER BY (code = 'WW') DESC, code`),
    opts,
  );
  return res.rows.map((r) => r.code);
}

export interface FilterSlugLookup {
  platformSlugs: readonly string[];
  genreSlugs: readonly string[];
  themeSlugs?: readonly string[];
  companySlugs?: readonly string[];
  franchiseSlugs?: readonly string[];
}

export interface FilterSlugIds {
  platforms: Map<string, number>;
  genres: Map<string, number>;
  themes: Map<string, number>;
  companies: Map<string, number>;
  /** franchises.slug 不是 unique（franchise 與 collection 可同 slug）→ 一個 slug 可能對到多個 id。 */
  franchises: Map<string, number[]>;
}

type Dim = "platform" | "genre" | "theme" | "company" | "franchise";

/** slug → id；不存在的 slug 不在結果內。mobile 平台視為不存在（不顯示，P35）。 */
export async function lookupFilterSlugs(q: FilterSlugLookup, opts: ReadOptions = {}): Promise<FilterSlugIds> {
  const out: FilterSlugIds = {
    platforms: new Map(),
    genres: new Map(),
    themes: new Map(),
    companies: new Map(),
    franchises: new Map(),
  };
  const themeSlugs = q.themeSlugs ?? [];
  const companySlugs = q.companySlugs ?? [];
  const franchiseSlugs = q.franchiseSlugs ?? [];
  const total = q.platformSlugs.length + q.genreSlugs.length + themeSlugs.length + companySlugs.length + franchiseSlugs.length;
  if (total === 0) return out;
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ dim: Dim; slug: string; id: number }>(sql`
        SELECT 'platform' AS dim, slug, id FROM platforms
        WHERE slug = ANY(${pgArray(q.platformSlugs)}::text[]) AND kind <> 'mobile'
        UNION ALL
        SELECT 'genre' AS dim, slug, id FROM genres WHERE slug = ANY(${pgArray(q.genreSlugs)}::text[])
        UNION ALL
        SELECT 'theme' AS dim, slug, id FROM themes WHERE slug = ANY(${pgArray(themeSlugs)}::text[])
        UNION ALL
        SELECT 'company' AS dim, slug, id FROM companies WHERE slug = ANY(${pgArray(companySlugs)}::text[])
        UNION ALL
        SELECT 'franchise' AS dim, slug, id FROM franchises WHERE slug = ANY(${pgArray(franchiseSlugs)}::text[])
      `),
    opts,
  );
  for (const r of res.rows) {
    if (r.dim === "platform") out.platforms.set(r.slug, r.id);
    else if (r.dim === "genre") out.genres.set(r.slug, r.id);
    else if (r.dim === "theme") out.themes.set(r.slug, r.id);
    else if (r.dim === "company") out.companies.set(r.slug, r.id);
    else {
      const list = out.franchises.get(r.slug) ?? [];
      list.push(r.id);
      out.franchises.set(r.slug, list);
    }
  }
  return out;
}
