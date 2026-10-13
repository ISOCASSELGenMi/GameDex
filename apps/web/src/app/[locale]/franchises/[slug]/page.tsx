// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { FranchiseDetailPage, franchisePageTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/franchises/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return {};
  const title = await franchisePageTitle(slug, locale, await searchParams);
  return title ? { title } : {};
}

export default async function Franchise({ params, searchParams }: PageProps<"/[locale]/franchises/[slug]">) {
  const { locale, slug } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  // 先確認存在再渲染（與遊戲詳情頁同做法）；不存在 → 軟 404（production 為 200＋noindex，3a 已接受）
  if (!(await franchisePageTitle(slug, locale, await searchParams))) notFound();
  return <FranchiseDetailPage locale={locale} supportedLocales={config.supported} slug={slug} searchParams={await searchParams} />;
}
