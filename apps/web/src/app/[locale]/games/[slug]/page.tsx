// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { GameDetailPage, loadGameDetail } from "@/modules/catalog/ui";
import { renderUiSlot } from "../../../_lib/slots";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/[locale]/games/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return {};
  const game = await loadGameDetail(slug, locale);
  return game ? { title: game.name } : {};
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
