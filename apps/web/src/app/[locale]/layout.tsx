// @module catalog
// 根版面（06 §多語系：語言只由 URL 前綴決定）。不讀 Cookie／標頭／pathname，可預渲染成靜態外殼。
// 不支援的語系在 proxy 已回 404；這裡的 notFound() 只是保險。
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createTranslator } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { THEME_INIT_SCRIPT } from "@/kernel/ui/theme";
import { LocaleBody, TOGGLE_TRANSITION_SCRIPT } from "@/modules/catalog/ui";
import { renderUiSlot } from "../_lib/slots";
import "../globals.css";
import "../themes.css";
import "../eggs.css";

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
    <html lang={locale} className="antialiased" suppressHydrationWarning>
      <head>
        {/* 首次繪製前套用使用者選的主題（localStorage），避免亮暗閃爍；伺服器 HTML 與使用者無關 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* 月曆開關換頁時，新頁面的 pagereveal 加上 cal-toggle（月曆本體 120ms 淡入；機制見 toggle-transition.ts） */}
        <script dangerouslySetInnerHTML={{ __html: TOGGLE_TRANSITION_SCRIPT }} />
      </head>
      <body>
        <LocaleBody locale={locale} headerRight={renderUiSlot("header.right", { locale })}>{children}</LocaleBody>
      </body>
    </html>
  );
}
