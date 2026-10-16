// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/auth";

// Better Auth 的所有端點（D81：basePath /api/v1/auth）。模組停用 → 404；MODULES=none 時不會建立 Better Auth 實例。
export const GET = guardModule("accounts", h.GET);
export const POST = guardModule("accounts", h.POST);
