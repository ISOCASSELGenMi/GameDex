/**
 * 停權者守門（D83）：停權帳號可以登入，但只能看說明、匯出資料、刪除帳號；所有新增或修改內容的 API 一律 403 `account_suspended`。
 * 判斷集中在這一處：`authenticate()`（account-data-request.ts）對寫入呼叫它，import／日曆這些自己取使用者的處理器也呼叫同一個函式。
 * 可例外的只有刪除帳號（DELETE /api/v1/account）。
 */
import type { CurrentUser } from "../domain/entities/account-view";

export const ACCOUNT_SUSPENDED = "account_suspended";

/** 停權者回 403 `{ code: "account_suspended" }`（no-store）；沒停權回 null。 */
export function suspendedResponse(user: Pick<CurrentUser, "suspended">): Response | null {
  return user.suspended
    ? Response.json({ code: ACCOUNT_SUSPENDED }, { status: 403, headers: { "Cache-Control": "no-store" } })
    : null;
}
