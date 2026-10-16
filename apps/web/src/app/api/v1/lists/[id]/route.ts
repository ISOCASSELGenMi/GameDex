// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-data";

export const GET = guardModule("accounts", h.list);
export const PATCH = guardModule("accounts", h.list);
export const DELETE = guardModule("accounts", h.list);
