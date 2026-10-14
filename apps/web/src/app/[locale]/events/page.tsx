// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { EventsListPage, PAGE_RULE, eventsTitle, seoMetadata } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/events">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const queryRules = [PAGE_RULE];
  return { title: eventsTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/events", searchParams: await searchParams, queryRules }) };
}

export default async function Events({ params, searchParams }: PageProps<"/[locale]/events">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <EventsListPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
