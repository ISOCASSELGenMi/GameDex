// @module admin
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { getLocaleConfig } from "@/kernel/locale";
import { IgdbFeedbackAdminPage } from "@/modules/admin/ui";

export const instant = false;
export const metadata: Metadata = { title: "待回饋 IGDB" };

export default async function InternalIgdbFeedback({ searchParams }: PageProps<"/internal/igdb-feedback">) {
  await connection();
  if (!isModuleEnabled("admin")) notFound();
  return <IgdbFeedbackAdminPage searchParams={await searchParams} publicLocale={getLocaleConfig().defaultLocale} />;
}
