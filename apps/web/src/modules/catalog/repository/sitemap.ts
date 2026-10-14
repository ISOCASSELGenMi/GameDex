/**
 * sitemap 用的讀取（Phase 3.5）：只取 slug 與更新時間。
 * 分片用 keyset：先用主鍵索引取得「第 shard × perShard 筆」的 id 當起點（OFFSET 只掃主鍵索引、不碰資料列），
 * 再 `WHERE id > 起點 ORDER BY id LIMIT perShard`。各分片的 id 範圍互不重疊；
 * 兩次請求之間若有新增，邊界上最多多／少幾筆，不影響正確性。
 */
import { sql, type SQL } from "drizzle-orm";
import type { SitemapCounts, SitemapEntry, SitemapShardedKind, SitemapSmallEntities } from "../domain/entities";
import { toIso, withReadTimeout, type ReadOptions } from "./read-tx";

/** sitemap 的查詢上限比一般讀取寬鬆（單片 1 萬列、計數掃全表），但仍有上限。 */
const SITEMAP_TIMEOUT_MS = 15_000;

export async function countSitemapEntities(opts: ReadOptions = {}): Promise<SitemapCounts> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ games: number; companies: number; franchises: number }>(sql`
        SELECT (SELECT count(*) FROM games)::int AS games,
               (SELECT count(*) FROM companies)::int AS companies,
               (SELECT count(*) FROM franchises)::int AS franchises`),
    { timeoutMs: SITEMAP_TIMEOUT_MS, ...opts },
  );
  const r = res.rows[0];
  return { games: r?.games ?? 0, companies: r?.companies ?? 0, franchises: r?.franchises ?? 0 };
}

interface SlugRow extends Record<string, unknown> {
  slug: string;
  updated_at: Date | string | null;
  kind?: "franchise" | "collection";
}

function select(kind: SitemapShardedKind): { table: SQL; columns: SQL } {
  switch (kind) {
    case "games":
      return { table: sql`games`, columns: sql`id, slug, updated_at` };
    case "companies":
      // companies 沒有 updated_at：不提供 lastmod
      return { table: sql`companies`, columns: sql`id, slug, NULL::timestamptz AS updated_at` };
    case "franchises":
      return { table: sql`franchises`, columns: sql`id, slug, kind, NULL::timestamptz AS updated_at` };
  }
}

/** 第 `shard`（0 起算）片：id 嚴格大於「第 shard × perShard 筆」的 id，依 id 取 perShard 筆。 */
export async function listSitemapShard(
  kind: SitemapShardedKind,
  shard: number,
  perShard: number,
  opts: ReadOptions = {},
): Promise<SitemapEntry[]> {
  const { table, columns } = select(kind);
  const skip = shard * perShard;
  // 第 0 片從頭；其餘片以「前面所有片的最後一筆 id」為起點（超過總筆數 → 子查詢為 NULL → 沒有列）
  const after = skip === 0 ? sql`TRUE` : sql`id > (SELECT id FROM ${table} ORDER BY id OFFSET ${skip - 1} LIMIT 1)`;
  const res = await withReadTimeout(
    (tx) => tx.execute<SlugRow>(sql`SELECT ${columns} FROM ${table} WHERE ${after} ORDER BY id LIMIT ${perShard}`),
    { timeoutMs: SITEMAP_TIMEOUT_MS, ...opts },
  );
  return res.rows.map((r) => ({
    slug: r.slug,
    lastModified: toIso(r.updated_at),
    ...(r.kind ? { kind: r.kind } : {}),
  }));
}

/** 平台（不含 mobile：頁面視為不存在，P35）與活動。量小，一次取完。 */
export async function listSitemapSmallEntities(opts: ReadOptions = {}): Promise<SitemapSmallEntities> {
  const res = await withReadTimeout(
    async (tx) => {
      const platforms = await tx.execute<SlugRow>(
        sql`SELECT slug, NULL::timestamptz AS updated_at FROM platforms WHERE kind <> 'mobile' ORDER BY id`,
      );
      const events = await tx.execute<SlugRow>(sql`SELECT slug, updated_at FROM events ORDER BY id`);
      return { platforms: platforms.rows, events: events.rows };
    },
    { timeoutMs: SITEMAP_TIMEOUT_MS, ...opts },
  );
  const map = (rows: SlugRow[]): SitemapEntry[] => rows.map((r) => ({ slug: r.slug, lastModified: toIso(r.updated_at) }));
  return { platforms: map(res.platforms), events: map(res.events) };
}
