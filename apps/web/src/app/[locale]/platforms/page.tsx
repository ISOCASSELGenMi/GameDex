// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PlatformsOverviewPage, platformsTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/platforms">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: platformsTitle(locale) };
}

export default async function Platforms({ params }: PageProps<"/[locale]/platforms">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <PlatformsOverviewPage locale={locale} supportedLocales={config.supported} />;
}
