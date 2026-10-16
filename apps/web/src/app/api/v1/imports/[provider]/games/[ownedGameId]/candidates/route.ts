// @module accounts
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/accounts/api/imports";

export const GET = guardModule("accounts", h.candidates);
