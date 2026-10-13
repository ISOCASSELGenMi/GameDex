// @module catalog
// 完全對不上路由、或語系不在支援清單（例如 /fr/...）時的 404。不經 [locale] 版面，所以各支援語系並列。
import type { Metadata } from "next";
import { createTranslator } from "@sok/i18n";
import { getLocaleConfig } from "@/kernel/locale";
import "./globals.css";

export const metadata: Metadata = { title: "404" };

export default function GlobalNotFound() {
  const { supported, defaultLocale } = getLocaleConfig();
  const ordered = [defaultLocale, ...supported.filter((l) => l !== defaultLocale)];
  return (
    <html lang={defaultLocale}>
      <body>
        <main id="main" className="mx-auto max-w-screen-md px-4 py-12">
          {ordered.map((locale, i) => {
            const t = createTranslator(locale);
            const Heading = i === 0 ? "h1" : "h2";
            return (
              <section key={locale} lang={locale} className={i === 0 ? undefined : "mt-8"}>
                <Heading className="text-2xl font-bold">{t.t("errors.notFound.title")}</Heading>
                <p className="mt-2">{t.t("errors.notFound.description")}</p>
                <p className="mt-2">
                  <a className="link" href={`/${locale}/calendar`}>
                    {t.t("errors.backToCalendar")}
                  </a>
                </p>
              </section>
            );
          })}
        </main>
      </body>
    </html>
  );
}
