// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { renderUiSlot } from "../../_lib/slots";
import { SubscribePage, seoMetadata, subscribeTitle } from "@/modules/catalog/ui";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/subscribe">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: subscribeTitle(locale), ...seoMetadata({ locale, config: getLocaleConfig(), path: "/subscribe" }) };
}

// 私人 feed 區塊屬 accounts（Phase 7）：從 registry 的 UI slot `subscribe.private` 取得（伺服器 HTML 與使用者無關，登入後才顯示由客戶端元件決定）。
export default async function Subscribe({ params, searchParams }: PageProps<"/[locale]/subscribe">) {
  const { locale } = await params;
  const raw = (await searchParams).platform;
  const platform = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase().slice(0, 100) || null;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <SubscribePage locale={locale} supportedLocales={config.supported} platform={platform} slots={{ privateFeed: renderUiSlot("subscribe.private", { locale }) }} />;
}
