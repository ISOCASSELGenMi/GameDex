// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-data";

export const POST = guardModule("accounts", h.listGame);
export const PATCH = guardModule("accounts", h.listGame);
export const DELETE = guardModule("accounts", h.listGame);
