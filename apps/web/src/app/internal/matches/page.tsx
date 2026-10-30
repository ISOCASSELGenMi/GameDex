// @module metacritic
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { MatchesAdminPage } from "@/modules/metacritic/ui";
import { createCsrfToken } from "@/modules/admin";

export const instant = false;
export const metadata: Metadata = { title: "Metacritic 比對覆核" };

// Basic auth、no-store、noindex 由 proxy.ts 對所有 /internal/* 處理（admin 模組沒啟用時 proxy 已回 404）
export default async function InternalMatches({ searchParams }: PageProps<"/internal/matches">) {
  await connection();
  if (!isModuleEnabled("metacritic") || !isModuleEnabled("admin")) notFound();
  return <MatchesAdminPage searchParams={await searchParams} csrf={createCsrfToken(process.env.ADMIN_BASIC_AUTH_PASS ?? "")} />;
}
