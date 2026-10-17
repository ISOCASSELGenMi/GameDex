// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { AdminUsersPage } from "@/modules/accounts/ui";
import { createCsrfToken } from "@/modules/admin";

export const instant = false;
export const metadata: Metadata = { title: "使用者管理" };

// Basic auth、no-store、noindex 由 proxy.ts 對所有 /internal/* 處理（admin 模組沒啟用時 proxy 已回 404）
export default async function InternalUsers({ searchParams }: PageProps<"/internal/users">) {
  await connection();
  if (!isModuleEnabled("accounts")) notFound();
  return <AdminUsersPage searchParams={await searchParams} csrf={createCsrfToken(process.env.ADMIN_BASIC_AUTH_PASS ?? "")} />;
}
