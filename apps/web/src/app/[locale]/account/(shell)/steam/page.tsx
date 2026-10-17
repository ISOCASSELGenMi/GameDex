// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { AccountSteamPageView, accountSubPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

// 帳號子頁不索引、不進 sitemap；內容與使用者無關（綁定狀態與遊戲庫由客戶端在登入後才取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/account/steam">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "steam"), robots: { index: false, follow: false } };
}

export default async function AccountSteam({ params }: PageProps<"/[locale]/account/steam">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return <AccountSteamPageView locale={locale} />;
}
