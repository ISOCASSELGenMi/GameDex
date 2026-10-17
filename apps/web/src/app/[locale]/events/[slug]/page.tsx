// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { renderUiSlot } from "../../../_lib/slots";
import { EventDetailPage, eventDetailMetadata, loadEventDetail, STATIC_SHELL_SLUG } from "@/modules/catalog/ui";

export const instant = false;
// ISR（同 games/[slug]）：資料讀取在 loadEventDetail 的 `use cache`（catalogDetail）；頁面不讀 searchParams／cookies／headers。
export const ensureStatic = "navigation";

export function generateStaticParams(): { slug: string }[] {
  return [{ slug: STATIC_SHELL_SLUG }];
}

export async function generateMetadata({ params }: PageProps<"/[locale]/events/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return {};
  const ev = await loadEventDetail(slug, locale);
  return ev ? eventDetailMetadata(ev, { locale, config: getLocaleConfig() }) : {};
}

export default async function EventPage({ params }: PageProps<"/[locale]/events/[slug]">) {
  const { locale, slug } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  // 先確認存在再渲染（與遊戲詳情頁同做法）；不存在 → 軟 404（production 為 200＋noindex，3a 已接受）
  if (!(await loadEventDetail(slug, locale))) notFound();
  return <EventDetailPage locale={locale} supportedLocales={config.supported} slug={slug} renderActions={(target) => renderUiSlot("entity.actions", { locale, ...target })} />;
}
