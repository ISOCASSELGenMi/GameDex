// @module catalog
// 根版面（06 §多語系：語言只由 URL 前綴決定）。不讀 Cookie／標頭／pathname，可預渲染成靜態外殼。
// 不支援的語系在 proxy 已回 404；這裡的 notFound() 只是保險。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createTranslator } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { LocaleBody } from "@/modules/catalog/ui";
import { renderUiSlot } from "../_lib/slots";
import "../globals.css";

export async function generateStaticParams(): Promise<{ locale: string }[]> {
  return getLocaleConfig().supported.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const t = createTranslator(locale);
  const name = t.t("ui.site.name");
  return { title: { default: name, template: `%s | ${name}` }, description: t.t("ui.site.tagline") };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return (
    <html lang={locale} className="antialiased">
      <body>
        <LocaleBody locale={locale} headerRight={renderUiSlot("header.right", { locale })}>{children}</LocaleBody>
      </body>
    </html>
  );
}
