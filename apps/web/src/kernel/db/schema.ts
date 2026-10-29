import { bigint, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// kernel 擁有的表（03 §同步狀態與變更紀錄、§表歸屬）

export const syncState = pgTable("sync_state", {
  jobName: varchar("job_name", { length: 64 }).primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), // 寫回「任務開始時間」，不是結束時間
  cursor: text("cursor"), // 回填進度
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }), // 任務心跳，供告警
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  /** 連續失敗次數（成功時歸零）；心跳告警用（16 §Uptime 與告警）。 */
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** 最近一次針對這個任務送出告警的時間（去重用；成功時清除）。 */
  lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const consumerCursors = pgTable("consumer_cursors", {
  consumerName: varchar("consumer_name", { length: 64 }).primaryKey(),
  lastChangeId: bigint("last_change_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

/**
 * 後台可調的站台設定（鍵值；12 §設定頁）。kernel 擁有：catalog（讀評分顯示、月曆預設）、metacritic（讀「允許抓取」）、admin（寫）三方共用，
 * 而 catalog 不能 import admin、kernel 不能 import 模組，所以放在 kernel。沒有列＝用環境變數／內建預設。
 */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: varchar("updated_by", { length: 128 }).notNull(),
});

/** 設定變更稽核（誰、何時、舊值→新值）。只增不改；還原成預設也寫一列（newValue 為 NULL）。 */
export const appSettingsAudit = pgTable(
  "app_settings_audit",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    changedBy: varchar("changed_by", { length: 128 }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_settings_audit_changed_idx").on(t.changedAt.desc(), t.id.desc())],
);
