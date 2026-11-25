/**
 * metacritic 模組擁有的表（02 §表歸屬）。只能被本模組的 repository 使用；模組移除時 drop。
 * metacritic_slugs：從 metacritic.com 公開的 sitemap（robots.txt 列出）取得的遊戲 slug 索引，用來在本機做標題候選搜尋
 * （站內搜尋 /search 被 robots.txt 禁止，所以不用）。只存 slug 與正規化後的名稱，不存其他內容。
 */
import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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

/**
 * metacritic_pages：遊戲頁快取（05 §頁面快取）。每個 slug 一列，存「解析後」的結果（不存 HTML、評論全文）：
 * ok／not_found／parse_failed 三種狀態，過期時間 expires_at 由 TTL 決定（use-cases/pages.ts）。
 * 欄位對應 provider 的 PageResult：userscore 與 ExternalScore 一樣是 100 分制（10 分制 ×10），metascore 為 0~100。
 */
export const metacriticPages = pgTable("metacritic_pages", {
  slug: varchar("slug", { length: 255 }).primaryKey(),
  /** 'ok' | 'not_found' | 'parse_failed'（pages.ts 的 PAGE_STATES）。 */
  state: varchar("state", { length: 16 }).notNull(),
  title: text("title"),
  releaseDate: date("release_date", { mode: "string" }),
  /** PageResult.year（ld+json datePublished 的年）；日期缺漏時仍可能有年份。 */
  releaseYear: integer("release_year"),
  companies: jsonb("companies").$type<string[]>().notNull().default([]),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  metascore: integer("metascore"),
  metascoreCount: integer("metascore_count"),
  userscore: numeric("userscore", { precision: 5, scale: 1, mode: "number" }),
  userscoreCount: integer("userscore_count"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
