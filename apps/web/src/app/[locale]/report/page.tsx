// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { ReportPage, reportTitle } from "@/modules/catalog/ui";

export const instant = false;

// 表單頁不索引（目標由查詢參數帶入，每個組合都是獨立網址；12）
export async function generateMetadata({ params }: PageProps<"/[locale]/report">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: reportTitle(locale), robots: { index: false, follow: false } };
}

export default async function Report({ params, searchParams }: PageProps<"/[locale]/report">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <ReportPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
