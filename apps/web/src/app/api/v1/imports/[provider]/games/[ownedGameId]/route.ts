// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/imports";

// 手動指定／否決／重設某筆匯入遊戲的比對（第 5 波）。模組停用 → 404。
export const PATCH = guardModule("accounts", h.PATCH);
