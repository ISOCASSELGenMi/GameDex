import { and, asc, eq, lt, ne } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import { isAuthProvider, USER_ROLES, type AuthProvider, type UserRole } from "../domain/entities/providers";
import { isPlaceholderEmail } from "../domain/entities/email";
import type { CurrentUser, LinkedAccountView } from "../domain/entities/account-view";
import { authVerifications, connectedAccounts, sessions, users } from "../schema";

const asRole = (v: string): UserRole => ((USER_ROLES as readonly string[]).includes(v) ? (v as UserRole) : "member");

export async function findUserById(id: number): Promise<CurrentUser | null> {
  const [row] = await getDb()
    .select({
      id: users.id,
      role: users.role,
      displayName: users.displayName,
      email: users.email,
      emailVerified: users.emailVerified,
      avatarUrl: users.avatarUrl,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    role: asRole(row.role),
    displayName: row.displayName,
    email: isPlaceholderEmail(row.email) ? null : row.email,
    emailVerified: row.emailVerified,
    avatarUrl: row.avatarUrl,
  };
}

/** 「已綁定的登入方式」：排除 credential（統一在這裡排除，D7）。 */
export async function listLinkedAccounts(userId: number): Promise<LinkedAccountView[]> {
  const rows = await getDb()
    .select({ id: connectedAccounts.id, provider: connectedAccounts.provider, connectedAt: connectedAccounts.connectedAt })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.userId, userId), ne(connectedAccounts.provider, "credential")))
    .orderBy(asc(connectedAccounts.connectedAt));
  return rows.flatMap((r) => (isAuthProvider(r.provider) ? [{ id: r.id, provider: r.provider as AuthProvider, connectedAt: r.connectedAt }] : []));
}

/** 每晚清理（09）：BA 不會主動刪過期的 session 與驗證／重設 token。 */
export async function deleteExpiredAuthRows(now: Date): Promise<{ sessions: number; verifications: number }> {
  const db = getDb();
  const s = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const v = await db.delete(authVerifications).where(lt(authVerifications.expiresAt, now)).returning({ id: authVerifications.id });
  return { sessions: s.length, verifications: v.length };
}
