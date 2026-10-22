// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { RatingsPage, ratingsTitle, seoMetadata } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/ratings">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  // 排序／門檻／篩選的變體都指回無參數的 /ratings；有任何查詢參數的變體 noindex
  const sp = await searchParams;
  const meta = { searchParams: sp, queryRules: [], filterPage: true };
  const base = seoMetadata({ locale, config: getLocaleConfig(), path: "/ratings", ...meta });
  const variant = Object.keys(sp).length > 0;
  return { title: ratingsTitle(locale), ...base, ...(variant ? { robots: { index: false, follow: true } } : {}) };
}

export default async function Ratings({ params, searchParams }: PageProps<"/[locale]/ratings">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <RatingsPage locale={locale} supportedLocales={config.supported} searchParams={await searchParams} />;
}
