// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-self";

export const GET = guardModule("accounts", h.accountPreferences);
export const PATCH = guardModule("accounts", h.accountPreferences);
