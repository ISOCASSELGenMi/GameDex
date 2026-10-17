// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { PublicListView, gateAccountsPage, loadPublicList, parseIdParam, publicListTitle } from "@/modules/accounts/ui";

export const instant = false;
// 動態頁（每次請求讀 DB，伺服器端以「匿名檢視者」讀取，不讀 Cookie）：HTML 與檢視者無關、不送 Set-Cookie。
// public 清單可被索引；private／不存在／停權者的清單一律 404。

const pageOf = (raw: string | string[] | undefined): number => {
  const n = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "1") : (raw ?? "1"), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
};

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/lists/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isSupportedLocale(locale)) return {};
  await gateAccountsPage();
  const listId = parseIdParam(id);
  if (listId === null) return {};
  const detail = await loadPublicList({ kind: "id", id: listId }, locale, pageOf((await searchParams).page));
  if (!detail) return {};
  return { title: publicListTitle(locale, detail), robots: { index: detail.list.visibility === "public", follow: true } };
}

export default async function PublicList({ params, searchParams }: PageProps<"/[locale]/lists/[id]">) {
  const { locale, id } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  const listId = parseIdParam(id);
  if (listId === null) notFound();
  const page = pageOf((await searchParams).page);
  const detail = await loadPublicList({ kind: "id", id: listId }, locale, page);
  if (!detail || detail.list.visibility !== "public") notFound();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path={`/lists/${listId}`} query={page > 1 ? `page=${page}` : ""}>
      <PublicListView locale={locale} detail={detail} page={page} token={null} pageHref={(p) => (p > 1 ? `/${locale}/lists/${listId}?page=${p}` : `/${locale}/lists/${listId}`)} />
    </PageShell>
  );
}
