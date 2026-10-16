// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { AccountPlaysPageView, accountSubPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/account/plays">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "plays"), robots: { index: false, follow: false } };
}

export default async function AccountPlays({ params }: PageProps<"/[locale]/account/plays">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/account/plays">
      <AccountPlaysPageView locale={locale} />
    </PageShell>
  );
}
