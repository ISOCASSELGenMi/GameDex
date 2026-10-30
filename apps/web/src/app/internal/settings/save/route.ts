// @module admin
import { guardModule } from "@/kernel/modules/guard";
import * as h from "@/modules/admin/api/settings";

export const POST = guardModule("admin", h.POST);
