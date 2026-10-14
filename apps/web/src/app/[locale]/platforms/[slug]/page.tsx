// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PlatformDetailPage, platformPageTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/platforms/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return {};
  const title = await platformPageTitle(slug, locale, await searchParams);
  return title ? { title } : {};
}

export default async function Platform({ params, searchParams }: PageProps<"/[locale]/platforms/[slug]">) {
  const { locale, slug } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  // 先確認存在再渲染（與遊戲詳情頁同做法）；不存在 → 軟 404（production 為 200＋noindex，3a 已接受）
  if (!(await platformPageTitle(slug, locale, await searchParams))) notFound();
  return <PlatformDetailPage locale={locale} supportedLocales={config.supported} slug={slug} searchParams={await searchParams} />;
}
