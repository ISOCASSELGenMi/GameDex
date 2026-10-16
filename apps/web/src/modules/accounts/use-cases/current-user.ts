import type { CurrentUser, LinkedAccountView } from "../domain/entities/account-view";
import { findUserById, listLinkedAccounts as listLinkedAccountsRepo } from "../repository/users";
import { getAuth } from "./auth-instance";

/**
 * 伺服器端取得目前登入者（Route Handler／之後的 API；頁面不呼叫它：頁面 HTML 與使用者無關，見 06）。
 * Better Auth 的 user.id 是字串（D1），在這裡轉 number；role 從 users 讀（BA 端點碰不到）。
 */
export async function getCurrentUser(headers: Headers): Promise<CurrentUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const id = Number(session.user.id);
  if (!Number.isInteger(id)) return null;
  return findUserById(id);
}

export function listLinkedAccounts(userId: number): Promise<LinkedAccountView[]> {
  return listLinkedAccountsRepo(userId);
}
