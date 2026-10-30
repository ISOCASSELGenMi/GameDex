// @module metacritic
// 比對覆核的確認／清除／手動輸入（12）。CSRF 與同源檢查是 admin 模組的實作，由這裡注入（metacritic 不能 import admin）。
import { guardModule } from "@/kernel/modules/guard";
import { createMatchesPost } from "@/modules/metacritic";
import { isSameOrigin, verifyCsrfToken } from "@/modules/admin";

export const POST = guardModule("metacritic", createMatchesPost({ verifyCsrfToken, isSameOrigin }));
