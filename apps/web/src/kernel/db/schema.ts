import { bigint, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// kernel 擁有的表（03 §同步狀態與變更紀錄、§表歸屬）

export const syncState = pgTable("sync_state", {
  jobName: varchar("job_name", { length: 64 }).primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), // 寫回「任務開始時間」，不是結束時間
  cursor: text("cursor"), // 回填進度
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }), // 任務心跳，供告警
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const consumerCursors = pgTable("consumer_cursors", {
  consumerName: varchar("consumer_name", { length: 64 }).primaryKey(),
  lastChangeId: bigint("last_change_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});
