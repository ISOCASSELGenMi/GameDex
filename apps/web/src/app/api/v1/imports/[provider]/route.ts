// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/imports";

// 遊戲庫匯入（Steam）：POST 開始匯入、GET 取得摘要與清單。模組停用 → 404。
export const GET = guardModule("accounts", h.GET);
export const POST = guardModule("accounts", h.POST);
