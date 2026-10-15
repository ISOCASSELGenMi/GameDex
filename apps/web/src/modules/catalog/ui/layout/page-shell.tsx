/**
 * 每頁共用的 header＋<main>。語言選單需要「目前路徑與 query」，只有頁面知道，所以 header 由頁面渲染
 * （版面不讀 pathname／searchParams，維持可快取）。頁尾署名在 [locale] 版面（SiteFooter）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { getTranslator } from "../labels";
import { eventsHref, gamesBrowseHref, languageMenuLinks, localeHref, platformsHref, subscribeHref, type LocalPath } from "../links";
import { LanguageMenu } from "./language-menu";

export interface PageShellProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  /** 去掉語系前綴的路徑，例如 `/calendar/2026-10`。 */
  path: LocalPath;
  /** 語言選單保留的 query（不含 ?）。 */
  query?: string;
  /** header 右側 slot（02：`header.right`，accounts 的登入按鈕）；3a 沒有提供者。 */
  headerRight?: ReactNode;
  children: ReactNode;
}

export function PageShell({ locale, supportedLocales, path, query = "", headerRight, children }: PageShellProps): ReactElement {
  const t = getTranslator(locale);
  const links = languageMenuLinks(locale, supportedLocales, path, query);
  // 主要導覽（月曆、時間軸、熱門榜、遊戲、平台、活動）。aria-current 依路徑判斷：
  // /games 只在瀏覽頁本身為 current（遊戲詳情 /games/{slug} 不標），其餘依路徑前綴。
  const navItems = [
    { path: "/calendar", href: localeHref(locale, "/calendar"), label: t.t("ui.nav.calendar"), exact: false },
    { path: "/timeline", href: localeHref(locale, "/timeline"), label: t.t("ui.nav.timeline"), exact: false },
    { path: "/trending", href: localeHref(locale, "/trending"), label: t.t("ui.nav.trending"), exact: false },
    { path: "/games", href: gamesBrowseHref(locale), label: t.t("ui.nav.games"), exact: true },
    { path: "/platforms", href: platformsHref(locale), label: t.t("ui.nav.platforms"), exact: false },
    { path: "/events", href: eventsHref(locale), label: t.t("ui.nav.events"), exact: false },
  ];
  const isCurrent = (item: { path: string; exact: boolean }) =>
    path === item.path || (!item.exact && path.startsWith(`${item.path}/`));
  return (
    <>
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <a href={localeHref(locale, "/calendar")} className="inline-flex min-h-11 items-center text-lg font-bold">
            {t.t("ui.site.name")}
          </a>
          <nav aria-label={t.t("a11y.mainNavigation")} className="flex-1">
            <ul className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <li key={item.path}>
                  <a
                    href={item.href}
                    aria-current={isCurrent(item) ? "page" : undefined}
                    className="link-quiet inline-flex min-h-11 items-center rounded-md px-2 aria-[current=page]:font-semibold aria-[current=page]:underline"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageMenu items={links} label={t.t("a11y.languageMenu")} />
          {headerRight}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-4 outline-none">
        {children}
      </main>
    </>
  );
}

export function SiteFooter({ locale }: { locale: Locale }): ReactElement {
  const t = getTranslator(locale);
  return (
    <footer className="border-t border-[var(--border)] px-4 py-4 text-sm text-[var(--muted)]">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-1">
        <p>
          <a href="https://www.igdb.com/" lang="en" className="underline" rel="noopener noreferrer">
            {t.t("ui.footer.dataAttribution")}
          </a>
        </p>
        <p>
          <a href={subscribeHref(locale)} className="inline-flex min-h-11 items-center underline">
            {t.t("ui.subscribe.footerLink")}
          </a>
        </p>
      </div>
    </footer>
  );
}

export function SkipLink({ locale }: { locale: Locale }): ReactElement {
  const t = getTranslator(locale);
  return (
    <a href="#main" className="skip-link">
      {t.t("a11y.skipToContent")}
    </a>
  );
}
