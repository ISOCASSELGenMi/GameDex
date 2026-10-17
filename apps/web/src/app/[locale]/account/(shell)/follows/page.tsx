// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { AccountFollowsPageView, accountSubPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

// 帳號子頁不索引、不進 sitemap；內容與使用者無關（登入狀態由客戶端元件取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/account/follows">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "follows"), robots: { index: false, follow: false } };
}

export default async function AccountFollows({ params }: PageProps<"/[locale]/account/follows">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <AccountFollowsPageView locale={locale} />
  );
}
