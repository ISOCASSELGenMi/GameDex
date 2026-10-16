// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { SubscribePage, seoMetadata, subscribeTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/subscribe">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: subscribeTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/subscribe" }) };
}

// 私人 feed 區塊屬 accounts（Phase 7）：之後從 registry 的 UI slot 取得，傳給 slots.privateFeed。
export default async function Subscribe({ params, searchParams }: PageProps<"/[locale]/subscribe">) {
  const { locale } = await params;
  const raw = (await searchParams).platform;
  const platform = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase().slice(0, 100) || null;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <SubscribePage locale={locale} supportedLocales={config.supported} platform={platform} />;
}
