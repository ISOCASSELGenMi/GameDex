// sitemap 用的讀取模型（Phase 3.5）。Domain 型別，零外部依賴。

/** 依 id 分片的實體種類（量大：遊戲、公司、系列）。 */
export const SITEMAP_SHARDED_KINDS = ["games", "companies", "franchises"] as const;
export type SitemapShardedKind = (typeof SITEMAP_SHARDED_KINDS)[number];

export interface SitemapCounts {
  games: number;
  companies: number;
  franchises: number;
}

/** 一個可索引網址的實體：slug＋最後更新時間（ISO 8601，無則 null）。系列另帶 kind（同 slug 的 franchise／collection 是不同頁）。 */
export interface SitemapEntry {
  slug: string;
  lastModified: string | null;
  kind?: "franchise" | "collection";
}

/** 量小、不分片的實體：平台（不含 mobile）與活動。 */
export interface SitemapSmallEntities {
  platforms: SitemapEntry[];
  events: SitemapEntry[];
}
