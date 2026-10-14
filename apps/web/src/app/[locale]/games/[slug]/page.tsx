// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { GameDetailPage, gameDetailMetadata, loadGameDetail, STATIC_SHELL_SLUG } from "@/modules/catalog/ui";
import { renderUiSlot } from "../../../_lib/slots";

export const instant = false;
// ISR（06 §SEO 與快取）：未列在 generateStaticParams 的 slug 第一次請求時等完整靜態結果產生，之後從快取送出（s-maxage＋SWR）。
// 資料讀取都在 loadGameDetail 的 `use cache` 內（cacheLife catalogDetail）；頁面不讀 searchParams／cookies／headers。
export const ensureStatic = "navigation";

export function generateStaticParams(): { slug: string }[] {
  return [{ slug: STATIC_SHELL_SLUG }];
}

export async function generateMetadata({ params }: PageProps<"/[locale]/games/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return {};
  const game = await loadGameDetail(slug, locale);
  return game ? gameDetailMetadata(game, { locale, config: getLocaleConfig() }) : {};
}

export default async function GamePage({ params }: PageProps<"/[locale]/games/[slug]">) {
  const { locale, slug } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  const game = await loadGameDetail(slug, locale);
  if (!game) notFound();
  const slotProps = { gameId: game.gameId, slug: game.slug, locale };
  return (
    <GameDetailPage
      locale={locale}
      supportedLocales={config.supported}
      slug={slug}
      slots={{ actions: renderUiSlot("game.actions", slotProps), sections: renderUiSlot("game.sections", slotProps) }}
    />
  );
}
