// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/account-data";

export const GET = guardModule("accounts", h.playRecords);
export const POST = guardModule("accounts", h.playRecords);
