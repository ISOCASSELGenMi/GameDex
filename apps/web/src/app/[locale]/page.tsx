// @module catalog
// /[locale] → 該語系當月月曆（保留 query）。
import { notFound } from "next/navigation";
import { isSupportedLocale } from "@/kernel/locale";
import { redirectToCurrentMonth } from "@/modules/catalog/ui";

export const instant = false;

export default async function LocaleIndex({ params, searchParams }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return redirectToCurrentMonth(locale, await searchParams);
}
