// @module catalog
// 法務與說明頁（16 §法務頁面）：靜態內容，內容是草稿（頁面上明示需專業人士審閱）。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { AboutPageView, aboutTitle, seoMetadata } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: PageProps<"/[locale]/about/contact">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: aboutTitle(locale, "contact"), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/about/contact" }) };
}

export default async function AboutContact({ params }: PageProps<"/[locale]/about/contact">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <AboutPageView locale={locale} supportedLocales={config.supported} page="contact" />;
}
