// @module accounts
// 停權／解除停權（12 §帳號停權）。CSRF 與同源檢查是 admin 模組的實作，由這裡注入（accounts 不能 import admin）。
import { guardModule } from "@/kernel/modules/guard";
import { createAdminUserPost } from "@/modules/accounts/api/admin-users";
import { isSameOrigin, verifyCsrfToken } from "@/modules/admin";

export const POST = guardModule("accounts", createAdminUserPost({ verifyCsrfToken, isSameOrigin }));
