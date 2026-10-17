// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/calendar";

export const PATCH = guardModule("accounts", h.feed);
