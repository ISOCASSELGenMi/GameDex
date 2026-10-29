import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { appSettings, appSettingsAudit } from "./schema";

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string;
}

export interface SettingAuditRow {
  id: number;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: Date;
}

/** 全部設定列（鍵很少，整張讀）。 */
export async function readAllSettingRows(): Promise<SettingRow[]> {
  return getDb().select().from(appSettings);
}

/** 一次套用多筆變更（同一個 transaction 寫設定與稽核）。value 為 null＝還原成預設（刪列）。 */
export async function applySettingChanges(
  changes: ReadonlyArray<{ key: string; value: unknown }>,
  actor: string,
  at: Date = new Date(),
): Promise<Array<{ key: string; oldValue: unknown; newValue: unknown }>> {
  if (changes.length === 0) return [];
  return getDb().transaction(async (tx) => {
    const before = await tx
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, changes.map((c) => c.key)));
    const old = new Map(before.map((r) => [r.key, r.value] as const));
    const applied: Array<{ key: string; oldValue: unknown; newValue: unknown }> = [];
    for (const c of changes) {
      const oldValue = old.has(c.key) ? old.get(c.key) : null;
      if (c.value === null) {
        if (!old.has(c.key)) continue;
        await tx.delete(appSettings).where(eq(appSettings.key, c.key));
      } else {
        await tx
          .insert(appSettings)
          .values({ key: c.key, value: c.value, updatedAt: at, updatedBy: actor })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: c.value, updatedAt: at, updatedBy: actor } });
      }
      await tx.insert(appSettingsAudit).values({ key: c.key, oldValue, newValue: c.value, changedBy: actor, changedAt: at });
      applied.push({ key: c.key, oldValue, newValue: c.value });
    }
    return applied;
  });
}

export async function readSettingAudit(limit: number, key?: string): Promise<SettingAuditRow[]> {
  const q = getDb().select().from(appSettingsAudit);
  return (key ? q.where(eq(appSettingsAudit.key, key)) : q)
    .orderBy(desc(appSettingsAudit.changedAt), desc(appSettingsAudit.id))
    .limit(limit);
}
