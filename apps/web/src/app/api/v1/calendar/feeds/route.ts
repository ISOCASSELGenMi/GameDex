// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/calendar";

export const GET = guardModule("accounts", h.feeds);
export const POST = guardModule("accounts", h.feeds);
