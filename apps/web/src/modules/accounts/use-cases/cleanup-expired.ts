import { deleteExpiredAuthRows } from "../repository/users";

/** 每晚清掉過期的 session 與 auth_verifications（Better Auth 不會主動清；09、K 報告 §5）。 */
export async function cleanupExpiredAuthRows(now: Date = new Date(), log: (message: string, extra?: Record<string, unknown>) => void = () => {}): Promise<{ sessions: number; verifications: number }> {
  const result = await deleteExpiredAuthRows(now);
  log("cleanup_auth_rows", result);
  return result;
}
