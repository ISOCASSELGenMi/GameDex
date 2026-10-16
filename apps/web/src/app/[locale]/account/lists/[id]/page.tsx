// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { AccountListDetailPageView, accountSubPageTitle, gateAccountsPage, parseIdParam } from "@/modules/accounts/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/account/lists/[id]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "list"), robots: { index: false, follow: false } };
}

export default async function AccountListDetail({ params }: PageProps<"/[locale]/account/lists/[id]">) {
  const { locale, id } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  const listId = parseIdParam(id);
  if (listId === null) notFound();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path={`/account/lists/${listId}`}>
      <AccountListDetailPageView locale={locale} listId={listId} />
    </PageShell>
  );
}
