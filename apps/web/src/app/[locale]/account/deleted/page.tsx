// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { AccountDeletedPageView, accountSubPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/account/deleted">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "deleted"), robots: { index: false, follow: false } };
}

// 刪除帳號後導向這裡（已登出；不需要登入）
export default async function AccountDeleted({ params }: PageProps<"/[locale]/account/deleted">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/account/deleted">
      <AccountDeletedPageView locale={locale} homeHref={`/${locale}`} />
    </PageShell>
  );
}
