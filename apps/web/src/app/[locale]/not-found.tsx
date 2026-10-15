// @module catalog
import { locale as rootLocale } from "next/root-params";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { NotFoundView } from "@/modules/catalog/ui";

export default async function LocaleNotFound() {
  const config = getLocaleConfig();
  // 多個根版面（[locale]、internal）並存後 rootLocale() 的型別含 undefined
  const raw = (await rootLocale()) ?? "";
  const locale = isSupportedLocale(raw, config) ? raw : config.defaultLocale;
  return <NotFoundView locale={locale} supportedLocales={config.supported} />;
}
