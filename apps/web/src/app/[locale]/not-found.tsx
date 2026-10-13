// @module catalog
import { locale as rootLocale } from "next/root-params";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { NotFoundView } from "@/modules/catalog/ui";

export default async function LocaleNotFound() {
  const config = getLocaleConfig();
  const raw = await rootLocale();
  const locale = isSupportedLocale(raw, config) ? raw : config.defaultLocale;
  return <NotFoundView locale={locale} supportedLocales={config.supported} />;
}
