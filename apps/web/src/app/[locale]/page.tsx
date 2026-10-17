// @module catalog
// /[locale]：首頁儀表板（即將上市、最新上市、近期活動、近期熱門）。舊書籤帶篩選參數的網址由 proxy 導向 /[locale]/calendar。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { HomePage, homeDescription, homeTitle, seoMetadata } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: { absolute: homeTitle(locale) }, description: homeDescription(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/" }) };
}

export default async function LocaleIndex({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <HomePage locale={locale} supportedLocales={config.supported} />;
}
