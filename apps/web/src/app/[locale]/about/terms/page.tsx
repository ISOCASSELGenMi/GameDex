// @module catalog
// 法務與說明頁（16 §法務頁面）：靜態內容，內容是草稿（頁面上明示需專業人士審閱）。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { AboutPageView, aboutTitle, seoMetadata } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: PageProps<"/[locale]/about/terms">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: aboutTitle(locale, "terms"), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/about/terms" }) };
}

export default async function AboutTerms({ params }: PageProps<"/[locale]/about/terms">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <AboutPageView locale={locale} supportedLocales={config.supported} page="terms" />;
}
