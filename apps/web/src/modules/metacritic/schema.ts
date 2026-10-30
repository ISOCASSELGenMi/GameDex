/**
 * metacritic 模組擁有的表（02 §表歸屬）。只能被本模組的 repository 使用；模組移除時 drop。
 * metacritic_slugs：從 metacritic.com 公開的 sitemap（robots.txt 列出）取得的遊戲 slug 索引，用來在本機做標題候選搜尋
 * （站內搜尋 /search 被 robots.txt 禁止，所以不用）。只存 slug 與正規化後的名稱，不存其他內容。
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const metacriticSlugs = pgTable(
  "metacritic_slugs",
  {
    slug: varchar("slug", { length: 255 }).primaryKey(),
    /** normalizeTitle(slug 還原的名稱)；候選搜尋用。 */
    nameNorm: text("name_norm").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("metacritic_slugs_name_trgm_idx").using("gin", sql`${t.nameNorm} gin_trgm_ops`)],
);
