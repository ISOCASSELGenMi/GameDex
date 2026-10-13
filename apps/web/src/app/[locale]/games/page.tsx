// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { GamesBrowsePage, gamesTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/games">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: gamesTitle(locale) };
}

export default async function Games({ params, searchParams }: PageProps<"/[locale]/games">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <GamesBrowsePage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
