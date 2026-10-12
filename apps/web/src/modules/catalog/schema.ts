/**
 * catalog 擁有的表（03 §表歸屬）。只能被 catalog 自己的 repository 使用（02 §資料夾結構）。
 * catalog 的表不得有 FK 指向其他模組。
 * 尚未建立：data_reports（Slice 2，見 12）。
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  DATE_PRECISIONS,
  EVENT_KINDS,
  FRANCHISE_KINDS,
  GAME_COMPANY_ROLES,
  GAME_LINK_TYPES,
  LANGUAGE_SUPPORT_TYPES,
  PLATFORM_KINDS,
  PLATFORM_STATUSES,
  RELEASE_STAGES,
  RELEASE_STATUSES,
  SCORE_PROVIDERS,
  SOURCE_STATUSES,
} from "./domain/entities/enums";

const tz = { withTimezone: true } as const;
const createdAt = () => timestamp("created_at", tz).defaultNow();
const updatedAt = () => timestamp("updated_at", tz).defaultNow().$onUpdate(() => new Date());

// ── enums ────────────────────────────────────────────────────────────────
export const datePrecisionEnum = pgEnum("date_precision", DATE_PRECISIONS);
export const releaseStatusEnum = pgEnum("release_status", RELEASE_STATUSES);
export const sourceStatusEnum = pgEnum("source_status", SOURCE_STATUSES);
export const releaseStageEnum = pgEnum("release_stage", RELEASE_STAGES);
export const platformKindEnum = pgEnum("platform_kind", PLATFORM_KINDS);
export const platformStatusEnum = pgEnum("platform_status", PLATFORM_STATUSES);
export const scoreProviderEnum = pgEnum("score_provider", SCORE_PROVIDERS);
export const gameCompanyRoleEnum = pgEnum("game_company_role", GAME_COMPANY_ROLES);
export const franchiseKindEnum = pgEnum("franchise_kind", FRANCHISE_KINDS);
export const gameLinkTypeEnum = pgEnum("game_link_type", GAME_LINK_TYPES);
export const eventKindEnum = pgEnum("event_kind", EVENT_KINDS);
export const languageSupportTypeEnum = pgEnum("language_support_type", LANGUAGE_SUPPORT_TYPES);

// ── 平台與地區 ────────────────────────────────────────────────────────────
export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 8 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
});

export const platformFamilies = pgTable("platform_families", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").unique(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
});

export const platforms = pgTable("platforms", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").unique(), // NULL 允許：人工新增的主機
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  abbreviation: varchar("abbreviation", { length: 32 }),
  alternativeName: varchar("alternative_name", { length: 100 }),
  kind: platformKindEnum("kind").notNull().default("other"), // mobile 不同步、不顯示（P35）
  generation: integer("generation"),
  familyId: integer("family_id").references(() => platformFamilies.id),
  logoUrl: text("logo_url"),
  summary: text("summary"),
  status: platformStatusEnum("status").notNull().default("active"),
  discontinuedOn: date("discontinued_on"), // 只能人工填
  source: varchar("source", { length: 16 }).notNull().default("igdb"),
});

export const platformReleaseDates = pgTable(
  "platform_release_dates",
  {
    platformId: integer("platform_id").notNull().references(() => platforms.id, { onDelete: "cascade" }),
    regionId: integer("region_id").notNull().references(() => regions.id),
    releaseDate: date("release_date"),
    precision: datePrecisionEnum("precision").notNull().default("day"),
    source: varchar("source", { length: 16 }).notNull().default("igdb"),
  },
  (t) => [primaryKey({ columns: [t.platformId, t.regionId] })],
);

// ── 遊戲 ─────────────────────────────────────────────────────────────────
export const games = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    igdbId: integer("igdb_id").notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary"),
    coverUrl: text("cover_url"),
    firstReleaseDate: date("first_release_date"),
    firstReleasePrecision: datePrecisionEnum("first_release_precision"),
    gameType: varchar("game_type", { length: 32 }).default("main_game"),
    parentGameId: integer("parent_game_id"), // 刻意不設 FK（本體可能尚未同步）
    gameStatus: varchar("game_status", { length: 16 }),
    popularityScore: integer("popularity_score").notNull().default(0), // 0~1000
    heatLevel: integer("heat_level").notNull().default(0), // 0~5，0＝不顯示
    displayNames: jsonb("display_names").$type<Record<string, string>>().default({}),
    searchText: text("search_text"),
    similarIgdbIds: jsonb("similar_igdb_ids").$type<number[]>().default([]),
    alternativeNames: jsonb("alternative_names").$type<{ name: string; comment: string | null }[]>().default([]),
    screenshotUrls: jsonb("screenshot_urls").$type<string[]>().default([]),
    trailerUrl: text("trailer_url"),
    ageRatingLabel: varchar("age_rating_label", { length: 32 }),
    lastFullSyncAt: timestamp("last_full_sync_at", tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("games_name_idx").on(t.name),
    index("games_parent_game_idx").on(t.parentGameId),
    index("games_type_popularity_idx").on(t.gameType, t.popularityScore.desc()),
    index("games_first_release_date_idx").on(t.firstReleaseDate),
    index("games_search_text_trgm_idx").using("gin", sql`${t.searchText} gin_trgm_ops`),
  ],
);

export const gamePlatforms = pgTable(
  "game_platforms",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    platformId: integer("platform_id").notNull().references(() => platforms.id),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.platformId] }), index("game_platforms_platform_game_idx").on(t.platformId, t.gameId)],
);

// ── 上市事件 ──────────────────────────────────────────────────────────────
export const releaseEvents = pgTable(
  "release_events",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    platformId: integer("platform_id").notNull().references(() => platforms.id),
    regionId: integer("region_id").notNull().references(() => regions.id),
    releaseDate: date("release_date"),
    periodStart: date("period_start"),
    precision: datePrecisionEnum("precision").notNull().default("day"),
    status: releaseStatusEnum("status").notNull().default("scheduled"),
    releaseStage: releaseStageEnum("release_stage").notNull().default("unspecified"),
    sourceStatus: sourceStatusEnum("source_status").notNull().default("active"),
    sequence: integer("sequence").notNull().default(0),
    source: varchar("source", { length: 32 }).default("igdb"),
    sourceUpdatedAt: timestamp("source_updated_at", tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("release_events_date_platform_idx").on(t.releaseDate, t.platformId),
    index("release_events_region_date_idx").on(t.regionId, t.releaseDate),
    index("release_events_period_start_idx").on(t.periodStart),
    index("release_events_diff_key_idx").on(t.gameId, t.platformId, t.regionId, t.releaseStage), // 刻意非 unique
  ],
);

export const releaseDateHistory = pgTable("release_date_history", {
  id: serial("id").primaryKey(),
  releaseEventId: integer("release_event_id").notNull().references(() => releaseEvents.id, { onDelete: "cascade" }),
  oldDate: date("old_date"),
  oldPrecision: datePrecisionEnum("old_precision"),
  newDate: date("new_date"),
  newPrecision: datePrecisionEnum("new_precision"),
  changedAt: timestamp("changed_at", tz).defaultNow(),
});

// ── 評分 ─────────────────────────────────────────────────────────────────
export const ratings = pgTable(
  "ratings",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    platformId: integer("platform_id").references(() => platforms.id),
    scoreOrigin: varchar("score_origin", { length: 32 }).notNull(),
    scoreProvider: scoreProviderEnum("score_provider").notNull(),
    scoreType: varchar("score_type", { length: 32 }).notNull().default("critic_aggregate"),
    score: integer("score"),
    scoreMax: integer("score_max").default(100),
    reviewCount: integer("review_count"),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", tz).defaultNow(),
    nextRefreshAt: timestamp("next_refresh_at", tz),
  },
  (t) => [
    // NULLS NOT DISTINCT：platformId 為 NULL 時也能擋重複並用 ON CONFLICT（D-Bug3）
    unique("ratings_game_platform_provider_type_uq")
      .on(t.gameId, t.platformId, t.scoreProvider, t.scoreType)
      .nullsNotDistinct(),
    index("ratings_next_refresh_idx").on(t.nextRefreshAt),
  ],
);

export const scoreSnapshots = pgTable("score_snapshots", {
  id: serial("id").primaryKey(),
  ratingId: integer("rating_id").notNull().references(() => ratings.id, { onDelete: "cascade" }),
  score: integer("score"),
  reviewCount: integer("review_count"),
  recordedAt: timestamp("recorded_at", tz).defaultNow(),
});

// ── 跨來源比對 ────────────────────────────────────────────────────────────
export const externalIds = pgTable(
  "external_ids",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 32 }).notNull(),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    externalUrl: text("external_url"),
    confidencePct: integer("confidence_pct"),
    needsReview: boolean("needs_review").notNull().default(false),
    matchMethod: varchar("match_method", { length: 8 }).notNull().default("auto"), // 'manual' 不得被排程覆寫
    matchedAt: timestamp("matched_at", tz).defaultNow(),
  },
  (t) => [
    uniqueIndex("external_ids_game_source_uq").on(t.gameId, t.source),
    index("external_ids_source_external_idx").on(t.source, t.externalId),
  ],
);

export const externalMatchAttempts = pgTable(
  "external_match_attempts",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 32 }).notNull(),
    lastAttemptedAt: timestamp("last_attempted_at", tz).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(1),
    lastResult: varchar("last_result", { length: 16 }).notNull(), // 'matched' | 'low_confidence' | 'no_candidate'
  },
  (t) => [primaryKey({ columns: [t.gameId, t.source] })],
);

export const externalIdRejections = pgTable(
  "external_id_rejections",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 32 }).notNull(),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    rejectedAt: timestamp("rejected_at", tz).defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.source, t.externalId] })],
);

// ── 公司、系列、類型、主題、在地化 ─────────────────────────────────────────
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  logoUrl: text("logo_url"),
  websiteUrl: text("website_url"),
});

export const gameCompanies = pgTable(
  "game_companies",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companies.id),
    role: gameCompanyRoleEnum("role").notNull(), // 同公司兼兩個角色就寫兩列
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.companyId, t.role] }),
    index("game_companies_company_game_idx").on(t.companyId, t.gameId),
  ],
);

export const franchises = pgTable(
  "franchises",
  {
    id: serial("id").primaryKey(),
    igdbId: integer("igdb_id").notNull(),
    kind: franchiseKindEnum("kind").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
  },
  (t) => [uniqueIndex("franchises_igdb_kind_uq").on(t.igdbId, t.kind)],
);

export const gameFranchises = pgTable(
  "game_franchises",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    franchiseId: integer("franchise_id").notNull().references(() => franchises.id),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.franchiseId] }),
    index("game_franchises_franchise_game_idx").on(t.franchiseId, t.gameId),
  ],
);

export const genres = pgTable("genres", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
});

export const gameGenres = pgTable(
  "game_genres",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    genreId: integer("genre_id").notNull().references(() => genres.id),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.genreId] }), index("game_genres_genre_game_idx").on(t.genreId, t.gameId)],
);

export const themes = pgTable("themes", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
});

export const gameThemes = pgTable(
  "game_themes",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    themeId: integer("theme_id").notNull().references(() => themes.id),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.themeId] }), index("game_themes_theme_game_idx").on(t.themeId, t.gameId)],
);

export const gameLocalizations = pgTable(
  "game_localizations",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    localeCode: varchar("locale_code", { length: 16 }).notNull(),
    name: text("name").notNull(),
    coverUrl: text("cover_url"),
    source: varchar("source", { length: 16 }).notNull().default("igdb"), // zh-Hant 名稱多靠人工
  },
  (t) => [primaryKey({ columns: [t.gameId, t.localeCode] })],
);

export const gameSimilarGames = pgTable(
  "game_similar_games",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    similarGameId: integer("similar_game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.similarGameId] })],
);

// ── 外部連結（不加 unique：由同步以 (gameId, categoryLabel) 去重，見 04）───────
export const gameExternalLinks = pgTable(
  "game_external_links",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    linkType: gameLinkTypeEnum("link_type").notNull(),
    igdbCategory: integer("igdb_category"),
    igdbOrigin: varchar("igdb_origin", { length: 16 }), // 'website' | 'external_game'
    categoryLabel: varchar("category_label", { length: 64 }).notNull(),
    url: text("url").notNull(),
    lastCheckedAt: timestamp("last_checked_at", tz),
    isBroken: boolean("is_broken").notNull().default(false),
    source: varchar("source", { length: 32 }).notNull().default("igdb"),
    createdAt: createdAt(),
  },
  (t) => [index("game_external_links_game_idx").on(t.gameId)],
);

// ── 活動 ─────────────────────────────────────────────────────────────────
export const eventSeries = pgTable("event_series", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  kind: eventKindEnum("kind").notNull().default("other"),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  igdbEventId: integer("igdb_event_id").unique(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  kind: eventKindEnum("kind").notNull().default("other"), // IGDB 沒有，人工標註
  seriesId: integer("series_id").references(() => eventSeries.id),
  startTime: timestamp("start_time", tz), // NULL＝時間未定，不進 iCal
  endTime: timestamp("end_time", tz),
  timezone: varchar("timezone", { length: 64 }), // IGDB 時區縮寫，只供顯示，不可計算
  logoUrl: text("logo_url"),
  streamUrl: text("stream_url"),
  url: text("url"),
  organizer: varchar("organizer", { length: 255 }),
  source: varchar("source", { length: 16 }).notNull().default("igdb"),
  gameIgdbIds: jsonb("game_igdb_ids").$type<number[]>().default([]),
  updatedAt: updatedAt(),
});

export const eventGames = pgTable(
  "event_games",
  {
    eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.gameId] }), index("event_games_game_event_idx").on(t.gameId, t.eventId)],
);

// ── 語言支援（沒有資料 ≠ 不支援；不做語言篩選，不建語言前綴索引）────────────────
export const languages = pgTable("languages", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").unique(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  nativeName: varchar("native_name", { length: 100 }),
});

export const gameLanguageSupports = pgTable(
  "game_language_supports",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    languageId: integer("language_id").notNull().references(() => languages.id),
    supportType: languageSupportTypeEnum("support_type").notNull(),
    source: varchar("source", { length: 16 }).notNull().default("igdb"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.languageId, t.supportType] })],
);

// ── 變更紀錄（outbox，D43）與熱度 ─────────────────────────────────────────
export const changeFeed = pgTable(
  "change_feed",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityType: varchar("entity_type", { length: 24 }).notNull(), // 'release_event' | 'game' | 'event'
    entityId: integer("entity_id").notNull(),
    changeType: varchar("change_type", { length: 24 }).notNull(), // 'created' | 'date_changed' | 'status_changed' | 'removed' | 'restored'
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", tz).defaultNow().notNull(),
  },
  (t) => [index("change_feed_entity_idx").on(t.entityType, t.entityId, t.id)],
);

export const gamePopularitySignals = pgTable(
  "game_popularity_signals",
  {
    gameId: integer("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    signalName: varchar("signal_name", { length: 32 }).notNull(),
    value: integer("value").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.signalName] })],
);

