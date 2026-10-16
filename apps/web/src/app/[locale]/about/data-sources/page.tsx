// @module catalog
// 法務與說明頁（16 §法務頁面）：靜態內容，內容是草稿（頁面上明示需專業人士審閱）。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { AboutPageView, aboutTitle, seoMetadata } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: PageProps<"/[locale]/about/data-sources">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: aboutTitle(locale, "data-sources"), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/about/data-sources" }) };
}

export default async function AboutDataSources({ params }: PageProps<"/[locale]/about/data-sources">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <AboutPageView locale={locale} supportedLocales={config.supported} page="data-sources" />;
}
