// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PAGE_RULE, TrendingViewPage, enumRule, seoMetadata, trendingTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/trending">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  // group=released 是另一份榜單（保留）；篩選變體指回無篩選版本
  const meta = { searchParams: await searchParams, queryRules: [enumRule("group", ["released"]), PAGE_RULE], filterPage: true };
  return { title: trendingTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/trending", ...meta }) };
}

export default async function Trending({ params, searchParams }: PageProps<"/[locale]/trending">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <TrendingViewPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
