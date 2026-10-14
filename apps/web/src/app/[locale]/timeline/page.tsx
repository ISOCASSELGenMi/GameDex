// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { TimelineViewPage, timelineTitle } from "@/modules/catalog/ui";

// 整頁在回應前算完（不串流），同月曆
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/timeline">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: timelineTitle(locale) };
}

export default async function Timeline({ params, searchParams }: PageProps<"/[locale]/timeline">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <TimelineViewPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
