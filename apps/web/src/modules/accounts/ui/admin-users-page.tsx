/**
 * /internal/users：使用者查詢與停權（12 §帳號停權）。伺服器元件；內部使用，介面文字固定 zh-Hant（同 /internal/reports）。
 * 查詢（信箱片段或 ID）→ 結果表 → 每列一個停權／解除表單（POST /internal/users/{id}，含 CSRF token）。
 * 沒有查詢時列出目前停權中的帳號。個資只在這個內部頁面顯示，稽核 log 只記 userId 與時間。
 */
import type { ReactElement } from "react";
import { AdminNav } from "@/kernel/ui/admin-nav";
import { adminSearchUsers, type AdminUserView } from "../use-cases/account-self";

const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");

const FLASH_ERROR: Record<string, string> = { user_not_found: "找不到這位使用者（可能已刪除帳號）" };

export interface AdminUsersPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  /** admin 模組產生的 CSRF token（由薄路由傳入）。 */
  csrf: string;
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function UserRow({ user, csrf, q }: { user: AdminUserView; csrf: string; q: string }): ReactElement {
  const suspended = user.suspendedAt !== null;
  return (
    <tr data-user-id={user.id} data-suspended={suspended ? "true" : "false"}>
      <th scope="row">#{user.id}</th>
      <td className="[overflow-wrap:anywhere]">{user.displayName}</td>
      <td className="[overflow-wrap:anywhere]">
        {user.email}
        {user.emailIsPlaceholder ? <span className="text-[var(--muted)]">（系統產生，無真實信箱）</span> : null}
      </td>
      <td>{user.role}</td>
      <td>{when(user.createdAt)}</td>
      <td>{suspended ? `停權中（${when(user.suspendedAt)}）` : "正常"}</td>
      <td>{user.activeSessions}</td>
      <td>
        <form method="post" action={`/internal/users/${user.id}`}>
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="q" value={q} />
          <button type="submit" name="action" value={suspended ? "unsuspend" : "suspend"} className={suspended ? "btn-secondary" : "btn-primary"}>
            {suspended ? "解除停權" : "停權"}
            <span className="sr-only">　#{user.id}</span>
          </button>
        </form>
      </td>
    </tr>
  );
}

export async function AdminUsersPage({ searchParams, csrf }: AdminUsersPageProps): Promise<ReactElement> {
  const q = (one(searchParams.q) ?? "").slice(0, 200);
  const users = await adminSearchUsers(q === "" ? null : q);

  const done = one(searchParams.done);
  const error = one(searchParams.error);
  const id = one(searchParams.id);
  const flash =
    done === "suspend"
      ? `#${id} 已停權${one(searchParams.unchanged) ? "（原本就是停權）" : ""}；已撤銷 ${one(searchParams.revoked) ?? "0"} 個登入狀態。`
      : done === "unsuspend"
        ? `#${id} 已解除停權${one(searchParams.unchanged) ? "（原本就沒有停權）" : ""}。`
        : null;

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">使用者管理</h1>
      <AdminNav current="users" />
      <form method="get" action="/internal/users" role="search" className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">信箱（片段）或使用者 ID</span>
          <input name="q" defaultValue={q} maxLength={200} className="min-h-8 text-sm w-72 max-w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3" />
        </label>
        <button type="submit" className="btn-primary">
          搜尋
        </button>
      </form>
      <p className="text-sm text-[var(--muted)]">
        停權的效果：追蹤不計熱度、玩家平均不計、公開與分享連結的清單對他人隱藏；停權時撤銷其所有登入狀態（登入狀態的資料快取最多 5 分鐘後失效）。停權者仍可重新登入，並可讀寫自己的資料、匯出與刪除帳號。
      </p>
      {flash ? (
        <p role="status" className="notice">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice">
          {FLASH_ERROR[error] ?? "處理失敗"}
        </p>
      ) : null}
      <section aria-label={q === "" ? "停權中的使用者" : "搜尋結果"} className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{q === "" ? `停權中的使用者（${users.length}）` : `搜尋結果（${users.length}${users.length >= 50 ? "，只顯示前 50 筆" : ""}）`}</h2>
        {users.length === 0 ? (
          <p>{q === "" ? "目前沒有停權中的使用者。輸入信箱或 ID 查詢。" : "沒有符合的使用者。"}</p>
        ) : (
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="使用者列表">
            <table className="release-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">顯示名稱</th>
                  <th scope="col">信箱</th>
                  <th scope="col">角色</th>
                  <th scope="col">註冊時間</th>
                  <th scope="col">狀態</th>
                  <th scope="col">有效登入</th>
                  <th scope="col">動作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} csrf={csrf} q={q} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
