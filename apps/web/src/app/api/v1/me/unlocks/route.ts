// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/unlocks";

export const GET = guardModule("accounts", h.unlocks);
export const POST = guardModule("accounts", h.unlocks);
