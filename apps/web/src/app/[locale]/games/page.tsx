// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { GamesBrowsePage, PAGE_RULE, gamesTitle, seoMetadata } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/games">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  // 篩選／排序／搜尋的變體都指回無篩選的 /games（分頁保留）；多維組合與搜尋結果 noindex
  const meta = { searchParams: await searchParams, queryRules: [PAGE_RULE], filterPage: true };
  return { title: gamesTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/games", ...meta }) };
}

export default async function Games({ params, searchParams }: PageProps<"/[locale]/games">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <GamesBrowsePage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
