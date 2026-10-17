// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { TimelineViewPage, seoMetadata, timelineTitle } from "@/modules/catalog/ui";
import { renderUiSlot } from "../../_lib/slots";

// 整頁在回應前算完（不串流），同月曆
export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/timeline">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  // `at`、篩選都不進正規網址；多維組合 noindex
  const meta = { searchParams: await searchParams, queryRules: [], filterPage: true };
  return { title: timelineTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/timeline", ...meta }) };
}

export default async function Timeline({ params, searchParams }: PageProps<"/[locale]/timeline">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <TimelineViewPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} slots={{ filterLinks: renderUiSlot("filter.links", { locale }), cardActions: renderUiSlot("card.actions", { locale }) }} />;
}
