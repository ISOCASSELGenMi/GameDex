import { eq } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import type { ListVisibility } from "../domain/entities/lists";
import type { ReviewVisibility } from "../domain/entities/play-records";
import { users } from "../schema";

export interface UserSettings {
  defaultListVisibility: ListVisibility;
  defaultReviewVisibility: ReviewVisibility;
  suspended: boolean;
}

/** 清單／遊玩紀錄建立時要用的使用者預設值與停權狀態。 */
export async function findUserSettings(userId: number): Promise<UserSettings | null> {
  const [row] = await getDb()
    .select({ l: users.defaultListVisibility, r: users.defaultReviewVisibility, s: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return { defaultListVisibility: row.l, defaultReviewVisibility: row.r, suspended: row.s !== null };
}

/** users.locale（使用者偏好語系；沒設為 null）。私人 feed 建立時的預設語系用。 */
export async function findUserLocale(userId: number): Promise<string | null> {
  const [row] = await getDb().select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.locale ?? null;
}
