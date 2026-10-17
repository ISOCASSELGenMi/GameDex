// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { PublicListView, gateAccountsPage, loadPublicList, publicListTitle } from "@/modules/accounts/ui";

export const instant = false;
// unlisted 清單（持分享網址才看得到）：永遠 noindex；token 錯誤、清單改回 private、擁有者停權一律 404。

const pageOf = (raw: string | string[] | undefined): number => {
  const n = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "1") : (raw ?? "1"), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
};

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/lists/s/[token]">): Promise<Metadata> {
  const { locale, token } = await params;
  if (!isSupportedLocale(locale)) return {};
  await gateAccountsPage();
  const detail = await loadPublicList({ kind: "token", token }, locale, pageOf((await searchParams).page));
  return { title: detail ? publicListTitle(locale, detail) : undefined, robots: { index: false, follow: false } };
}

export default async function SharedList({ params, searchParams }: PageProps<"/[locale]/lists/s/[token]">) {
  const { locale, token } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  const page = pageOf((await searchParams).page);
  const detail = await loadPublicList({ kind: "token", token }, locale, page);
  if (!detail) notFound();
  const base = `/${locale}/lists/s/${encodeURIComponent(token)}`;
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path={`/lists/s/${encodeURIComponent(token)}`} query={page > 1 ? `page=${page}` : ""}>
      <PublicListView locale={locale} detail={detail} page={page} token={token} pageHref={(p) => (p > 1 ? `${base}?page=${p}` : base)} />
    </PageShell>
  );
}
