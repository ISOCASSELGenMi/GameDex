// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { TrendingViewPage, trendingTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/trending">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: trendingTitle(locale) };
}

export default async function Trending({ params, searchParams }: PageProps<"/[locale]/trending">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <TrendingViewPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
