/**
 * [locale] 版面的 <body> 內容：跳到主要內容、錯誤字串、頁面、頁尾署名。
 * 不讀 pathname／Cookie／標頭（版面可預渲染；06 §SEO 與快取）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { EggLayer, type EggLabels } from "@/kernel/ui/eggs/egg-layer";
import { UNLOCK_ACHIEVEMENT_KEYS, UNLOCK_COLLECTIBLE_KEYS } from "@/kernel/ui/unlocks";
import { THEME_OPTIONS } from "@/kernel/ui/theme";
import { getTranslator } from "../labels";
import { localeHref } from "../links";
import { ErrorStringsProvider, type ErrorStrings } from "./error-view";
import { HeaderRightProvider } from "./header-right";
import { PageShell, SiteFooter, SkipLink } from "./page-shell";

/** `memory-card` → `memoryCard`；`viewed-50-games` → `viewed50Games`（字典 key 用 camelCase）。 */
function camel(key: string): string {
  return key.replace(/-(w)/g, (_, c: string) => c.toUpperCase());
}

export function LocaleBody({ locale, headerRight, children }: { locale: Locale; headerRight?: ReactNode; children: ReactNode }): ReactElement {
  const t = getTranslator(locale);
  const errorStrings: ErrorStrings = {
    serverErrorTitle: t.t("errors.serverError.title"),
    serverErrorDescription: t.t("errors.serverError.description"),
    queryTimeoutTitle: t.t("errors.queryTimeoutTitle"),
    queryTimeout: t.t("errors.queryTimeout"),
    tryAgain: t.t("errors.tryAgain"),
    backToCalendar: t.t("errors.backToCalendar"),
    clearFilters: t.t("filters.clearAll"),
    calendarHref: localeHref(locale, "/calendar"),
  };
  const eggLabels: EggLabels = {
    unlockedTheme: t.t("ui.egg.unlockedTheme"),
    unlockedCollectible: t.t("ui.egg.unlockedCollectible"),
    unlockedAchievement: t.t("ui.egg.unlockedAchievement"),
    apply: t.t("ui.egg.apply"),
    close: t.t("ui.egg.close"),
    themes: Object.fromEntries(THEME_OPTIONS.filter((o) => o.locked).map((o) => [o.id, t.t(`ui.theme.${o.labelKey}`)])),
    collectibles: Object.fromEntries(UNLOCK_COLLECTIBLE_KEYS.map((k) => [k, t.t(`ui.egg.collectible.${camel(k)}`)])),
    achievements: Object.fromEntries(UNLOCK_ACHIEVEMENT_KEYS.map((k) => [k, t.t(`ui.egg.achievement.${camel(k)}`)])),
  };
  return (
    <>
      <SkipLink locale={locale} />
      <EggLayer labels={eggLabels} />
      <ErrorStringsProvider value={errorStrings}>
        <HeaderRightProvider value={headerRight ?? null}>
          <div className="flex min-h-screen flex-col">
            {children}
            <SiteFooter locale={locale} />
          </div>
        </HeaderRightProvider>
      </ErrorStringsProvider>
    </>
  );
}

/** [locale]/not-found.tsx 的內容（語言選單指向各語系的月曆）。 */
export function NotFoundView({ locale, supportedLocales }: { locale: Locale; supportedLocales: readonly Locale[] }): ReactElement {
  const t = getTranslator(locale);
  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/calendar">
      <h1 className="text-2xl font-bold">{t.t("errors.notFound.title")}</h1>
      <p className="mt-2">{t.t("errors.notFound.description")}</p>
      <p className="mt-4">
        <a className="btn-primary" href={localeHref(locale, "/calendar")}>
          {t.t("errors.backToCalendar")}
        </a>
      </p>
    </PageShell>
  );
}
