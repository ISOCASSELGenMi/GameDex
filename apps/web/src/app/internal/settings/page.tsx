// @module admin
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { SettingsAdminPage } from "@/modules/admin/ui";
import { allModules } from "@/modules/registry";

export const instant = false;
export const metadata: Metadata = { title: "網站設定" };

export default async function InternalSettings({ searchParams }: PageProps<"/internal/settings">) {
  await connection();
  if (!isModuleEnabled("admin")) notFound();
  const modules = allModules().map((m) => ({ name: m.name, kind: m.kind, enabled: m.kind === "core" || isModuleEnabled(m.name), requires: m.requires }));
  return <SettingsAdminPage searchParams={await searchParams} modules={modules} />;
}
