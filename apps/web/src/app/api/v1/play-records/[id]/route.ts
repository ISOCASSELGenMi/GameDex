// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-data";

export const PATCH = guardModule("accounts", h.playRecord);
export const DELETE = guardModule("accounts", h.playRecord);
