// @module admin
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { SyncAdminPage } from "@/modules/admin/ui";
import { enabledModules } from "@/modules/registry";

export const instant = false;
export const metadata: Metadata = { title: "同步監控" };

export default async function InternalSync() {
  await connection();
  if (!isModuleEnabled("admin")) notFound();
  const jobs = enabledModules().flatMap((m) => (m.jobs ?? []).map((j) => ({ name: j.name, cron: j.cron, lockMode: j.lockMode, module: m.name })));
  return <SyncAdminPage jobs={jobs} />;
}
