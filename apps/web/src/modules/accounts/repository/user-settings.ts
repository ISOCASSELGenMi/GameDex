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
