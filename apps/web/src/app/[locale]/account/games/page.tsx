// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { AccountMyGamesPageView, accountSubPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

// 帳號子頁不索引、不進 sitemap；內容與使用者無關（登入狀態由客戶端元件取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/account/games">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "games"), robots: { index: false, follow: false } };
}

export default async function AccountGames({ params }: PageProps<"/[locale]/account/games">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/account/games">
      <AccountMyGamesPageView locale={locale} />
    </PageShell>
  );
}
