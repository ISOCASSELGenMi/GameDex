// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/follows";

export const PUT = guardModule("accounts", h.followTarget);
export const DELETE = guardModule("accounts", h.followTarget);
