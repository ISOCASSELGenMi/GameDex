/**
 * accounts 擁有的表（03 §帳號、§表歸屬）。只能被 accounts 自己的 repository 使用。
 * 第 1 波：users、connected_accounts、sessions、auth_verifications、auth_tokens。
 * users／connected_accounts／sessions／auth_verifications 是 Better Auth 的 user／account／session／verification
 * （modelName 與欄位對應見 providers/auth/options.ts；D76～D81）。
 */
import { boolean, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
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
