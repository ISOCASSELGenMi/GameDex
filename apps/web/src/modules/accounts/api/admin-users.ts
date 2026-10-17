/**
 * /internal/users 的停權 POST（薄路由 app/internal/users/[id]/route.ts 以 guardModule("accounts") 包住，並注入 admin 模組的 CSRF 檢查）。
 */
import { connection } from "next/server";
import { handleAdminUserAction, type AdminCsrfDeps } from "../use-cases/admin-users-request";

export type { AdminCsrfDeps };

export function createAdminUserPost(deps: AdminCsrfDeps) {
  return async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
    await connection();
    return handleAdminUserAction(request, (await ctx.params).id, deps);
  };
}
