// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-self";

export const DELETE = guardModule("accounts", h.account);
