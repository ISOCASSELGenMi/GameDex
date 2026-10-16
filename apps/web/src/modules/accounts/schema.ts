/**
 * accounts 擁有的表（03 §帳號、§表歸屬）。只能被 accounts 自己的 repository 使用。
 * 第 1 波：users、connected_accounts、sessions、auth_verifications、auth_tokens；第 3 波：owned_games；第 5 波：user_lists、user_list_games、play_records、game_player_ratings；
 * 第 6 波：follows、calendar_feeds。
 * users／connected_accounts／sessions／auth_verifications 是 Better Auth 的 user／account／session／verification
 * （modelName 與欄位對應見 providers/auth/options.ts；D76～D81）。
 */
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, smallint, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { FEED_TYPES } from "./domain/entities/calendar-feeds";
import { FOLLOW_TARGETS } from "./domain/entities/follows";
import { PLAY_STATUSES } from "./domain/entities/play-records";
import { LIST_VISIBILITIES, REVIEW_VISIBILITIES } from "./domain/entities/providers";

const tz = { withTimezone: true } as const;

export const listVisibilityEnum = pgEnum("list_visibility", LIST_VISIBILITIES);
export const reviewVisibilityEnum = pgEnum("review_visibility", REVIEW_VISIBILITIES);

export const users = pgTable("users", {
  id: serial("id").primaryKey(), // advanced.database.generateId: "serial"；Better Auth 對外為字串
  email: varchar("email", { length: 255 }).notNull().unique(), // 一律小寫；無信箱者用 placeholder（D77）
  emailVerified: boolean("email_verified").notNull().default(false),
  displayName: varchar("display_name", { length: 100 }).notNull(), // BA `name`
  handle: varchar("handle", { length: 32 }).unique(),
  avatarUrl: text("avatar_url"), // BA `image`
  timezone: varchar("timezone", { length: 64 }).default("Asia/Taipei"),
  locale: varchar("locale", { length: 16 }),
  preferredRegion: varchar("preferred_region", { length: 8 }),
  scoreProviders: jsonb("score_providers").$type<string[]>(),
  preferredPlatformIds: jsonb("preferred_platform_ids").$type<number[]>().default([]),
  defaultListVisibility: listVisibilityEnum("default_list_visibility").notNull().default("private"),
  defaultReviewVisibility: reviewVisibilityEnum("default_review_visibility").notNull().default("public"),
  suspendedAt: timestamp("suspended_at", tz),
  role: varchar("role", { length: 16 }).notNull().default("member"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(), // BA providerId；允許值見 domain AUTH_PROVIDERS
    providerAccountId: varchar("provider_account_id", { length: 128 }).notNull(), // credential 列為 userId
    accessToken: text("access_token"), // 應用層 AES-256-GCM（TOKEN_ENCRYPTION_KEY）
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    expiresAt: timestamp("expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"), // 只有 provider='credential' 列；argon2id（D79）
    connectedAt: timestamp("connected_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("connected_accounts_provider_account_uq").on(t.provider, t.providerAccountId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).notNull().unique(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: serial("id").primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(), // storeIdentifier: "hashed"（只存雜湊）
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier), index("auth_verifications_expires_idx").on(t.expiresAt)],
);

/** 只剩通知雙重確認（7.5；D80）。 */
export const authTokens = pgTable("auth_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: varchar("purpose", { length: 24 }).notNull(), // AUTH_TOKEN_PURPOSES
  expiresAt: timestamp("expires_at", tz).notNull(),
  usedAt: timestamp("used_at", tz),
});

/**
 * 平台匯入的原始紀錄（03；第 3 波：Steam）。需比對才能對到 catalog 的 games。
 * matchConfidencePct：NULL＝尚未比對；0＝比對過但沒有候選；其他＝信心（matchedGameId 為 NULL 表示低信心待確認，不自動採用）。
 * matchedGameId 刻意不用 .references()：accounts 的 schema 不能 import catalog 的 schema（lint:arch）。
 * 外鍵 owned_games_matched_game_id_games_id_fk（ON DELETE SET NULL）寫在 migration 0008 的手寫段落。
 */
export const ownedGames = pgTable(
  "owned_games",
  {
    id: serial("id").primaryKey(),
    connectedAccountId: integer("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    externalGameId: varchar("external_game_id", { length: 128 }).notNull(), // Steam AppID
    externalTitle: text("external_title").notNull(),
    matchedGameId: integer("matched_game_id"),
    matchConfidencePct: integer("match_confidence_pct"),
    /** 'auto'｜'manual'（第 5 波）。manual＝使用者手動指定（pct 100）或否決（matchedGameId NULL、pct 0）；匯入重比與排程比對都不碰。 */
    matchMethod: varchar("match_method", { length: 8 }).notNull().default("auto"),
    importedAt: timestamp("imported_at", tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("owned_games_account_external_uq").on(t.connectedAccountId, t.externalGameId),
    index("owned_games_unmatched_idx").on(t.id).where(sql`${t.matchConfidencePct} IS NULL`),
    index("owned_games_matched_game_idx").on(t.matchedGameId),
  ],
);

// ── 第 5 波：收藏清單、遊玩紀錄、玩家平均（03 §收藏、遊玩紀錄、追蹤）─────────────────────────
// 對 catalog 表的外鍵（games／platforms）不能寫在這裡（lint:arch：accounts 的 schema 不能 import catalog 的 schema）；
// 寫在 migration 0009 的手寫段落：user_list_games.game_id、play_records.game_id、game_player_ratings.game_id → games(id) ON DELETE CASCADE；
// play_records.platform_id → platforms(id) ON DELETE SET NULL。

export const userLists = pgTable(
  "user_lists",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    visibility: listVisibilityEnum("visibility").notNull().default("private"),
    shareToken: varchar("share_token", { length: 32 }).unique(), // 只有 unlisted 才有
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("user_lists_user_sort_idx").on(t.userId, t.sortOrder, t.id)],
);

export const userListGames = pgTable(
  "user_list_games",
  {
    listId: integer("list_id")
      .notNull()
      .references(() => userLists.id, { onDelete: "cascade" }),
    gameId: integer("game_id").notNull(),
    position: integer("position").notNull().default(0),
    note: text("note"),
    addedAt: timestamp("added_at", tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.gameId] }), index("user_list_games_game_idx").on(t.gameId), index("user_list_games_list_position_idx").on(t.listId, t.position)],
);

export const playStatusEnum = pgEnum("play_status", PLAY_STATUSES);

export const playRecords = pgTable(
  "play_records",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: integer("game_id").notNull(),
    platformId: integer("platform_id"),
    status: playStatusEnum("status").notNull(),
    startedOn: date("started_on"),
    finishedOn: date("finished_on"),
    playMinutes: integer("play_minutes"),
    ratingHalfSteps: smallint("rating_half_steps"), // 1~20 = 0.5~10 分（P42）；NULL = 未評分
    review: text("review"),
    reviewHasSpoilers: boolean("review_has_spoilers").notNull().default(false),
    reviewVisibility: reviewVisibilityEnum("review_visibility").notNull().default("public"),
    privateNote: text("private_note"), // 永遠不公開
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("play_records_user_game_idx").on(t.userId, t.gameId),
    index("play_records_game_rated_idx").on(t.gameId).where(sql`${t.ratingHalfSteps} IS NOT NULL`),
    index("play_records_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

export const gamePlayerRatings = pgTable("game_player_ratings", {
  gameId: integer("game_id").primaryKey(),
  avgHalfSteps: numeric("avg_half_steps", { precision: 4, scale: 2 }),
  ratingCount: integer("rating_count").notNull().default(0),
  avgPlayMinutes: integer("avg_play_minutes"),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

// ── 第 6 波：追蹤、私人 iCal 訂閱 ───────────────────────────────────────────────────────────
// follows 的 target_id 依 target_type 指向 catalog 的表（多型參照，沒有 FK；03）：catalog 刪除目標時由每晚 cleanup_orphan_follows 刪掉孤兒列。

export const followTargetEnum = pgEnum("follow_target", FOLLOW_TARGETS);

export const follows = pgTable(
  "follows",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: followTargetEnum("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
    index("follows_by_target_idx").on(t.targetType, t.targetId),
    index("follows_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const feedTypeEnum = pgEnum("feed_type", FEED_TYPES);

/** 每位使用者最多一個有效的 following feed（partial unique）。重新產生＝舊列標 revoked_at、新增一列。 */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(), // SHA-256（hex），查驗用
    tokenCiphertext: text("token_ciphertext"), // TOKEN_ENCRYPTION_KEY 加密（token-cipher），供再次顯示（P9、D34）
    name: varchar("name", { length: 100 }).notNull().default("My Game Calendar"),
    locale: varchar("locale", { length: 16 }).notNull().default("zh-Hant"),
    settingsVersion: integer("settings_version").notNull().default(0), // 設定或語系變更時 +1，納入 ETag
    feedType: feedTypeEnum("feed_type").notNull().default("all"),
    filterPlatforms: jsonb("filter_platforms").$type<number[]>().notNull().default([]),
    filterRegions: jsonb("filter_regions").$type<number[]>().notNull().default([]),
    filterGenres: jsonb("filter_genres").$type<string[]>().notNull().default([]),
    filterStages: jsonb("filter_stages").$type<string[]>().notNull().default([]),
    includeReleases: boolean("include_releases").notNull().default(true),
    includeEvents: boolean("include_events").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", tz),
    revokedAt: timestamp("revoked_at", tz),
  },
  (t) => [
    uniqueIndex("calendar_feeds_following_active_uq")
      .on(t.userId)
      .where(sql`${t.feedType} = 'following' AND ${t.revokedAt} IS NULL`),
    index("calendar_feeds_user_created_idx").on(t.userId, t.createdAt),
  ],
);
