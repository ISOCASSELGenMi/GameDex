// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/follows";

export const GET = guardModule("accounts", h.follows);
