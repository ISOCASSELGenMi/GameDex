import type { SitemapCounts, SitemapEntry, SitemapShardedKind, SitemapSmallEntities } from "../../domain/entities";
import { countSitemapEntities, listSitemapShard, listSitemapSmallEntities } from "../../repository/sitemap";

/** sitemap 各實體的數量（決定分片數）。 */
export function getSitemapCounts(): Promise<SitemapCounts> {
  return countSitemapEntities();
}

export interface ListSitemapShardInput {
  kind: SitemapShardedKind;
  /** 0 起算。 */
  shard: number;
  /** 每片幾個實體（1 以上、100,000 以下）。 */
  perShard: number;
}

/** 某分片的實體（依 id 的 keyset）。參數不合法 → 空陣列。 */
export async function listSitemapEntries(input: ListSitemapShardInput): Promise<SitemapEntry[]> {
  const { kind, shard, perShard } = input;
  if (!Number.isInteger(shard) || shard < 0 || shard > 100_000) return [];
  if (!Number.isInteger(perShard) || perShard < 1 || perShard > 100_000) return [];
  return listSitemapShard(kind, shard, perShard);
}

/** 平台（不含 mobile）與活動。 */
export function listSitemapSmall(): Promise<SitemapSmallEntities> {
  return listSitemapSmallEntities();
}
