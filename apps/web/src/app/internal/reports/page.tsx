// @module admin
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { getLocaleConfig } from "@/kernel/locale";
import { ReportsAdminPage } from "@/modules/admin/ui";

export const instant = false;
export const metadata: Metadata = { title: "資料更正回報" };

export default async function InternalReports({ searchParams }: PageProps<"/internal/reports">) {
  await connection();
  if (!isModuleEnabled("admin")) notFound();
  return <ReportsAdminPage searchParams={await searchParams} publicLocale={getLocaleConfig().defaultLocale} />;
}
