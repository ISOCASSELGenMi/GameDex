// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { EventsListPage, eventsTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/events">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: eventsTitle(locale) };
}

export default async function Events({ params, searchParams }: PageProps<"/[locale]/events">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <EventsListPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
