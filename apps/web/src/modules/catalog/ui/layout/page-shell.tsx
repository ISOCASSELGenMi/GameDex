/**
 * 每頁共用的 header＋<main>。語言選單需要「目前路徑與 query」，只有頁面知道，所以 header 由頁面渲染
 * （版面不讀 pathname／searchParams，維持可快取）。頁尾署名在 [locale] 版面（SiteFooter）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { getTranslator } from "../labels";
import { aboutHref, eventsHref, gamesBrowseHref, languageMenuLinks, localeHref, platformsHref, subscribeHref, type LocalPath } from "../links";
import { HeaderMenu } from "./header-menu";
import { HeaderRightOutlet } from "./header-right";
import { FollowingLanguageMenu } from "./following-language-menu";
import { LanguageMenu } from "./language-menu";
import { orgLink } from "./org-link";

export interface PageShellProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  /** 去掉語系前綴的路徑，例如 `/calendar/2026-10`。 */
  path: LocalPath;
  /** 語言選單保留的 query（不含 ?）。 */
  query?: string;
  /** true＝語言選單的連結跟著目前網址走（客戶端導覽切換子頁的版面用，例如帳號頁殼）。 */
  followPathname?: boolean;
  /** header 右側 slot（02：`header.right`，accounts 的登入按鈕）；由根版面經 HeaderRightProvider 提供時不必傳（預設 <HeaderRightOutlet />）。 */
  headerRight?: ReactNode;
  children: ReactNode;
}

export function PageShell({ locale, supportedLocales, path, query = "", followPathname = false, headerRight, children }: PageShellProps): ReactElement {
  const t = getTranslator(locale);
  const links = languageMenuLinks(locale, supportedLocales, path, query);
  const org = orgLink();
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
      <header className="site-header">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          {org ? (
            <a href={org.href} data-org-link="header" className="link-quiet inline-flex min-h-11 items-center text-sm text-[var(--muted)]">
              {t.t("ui.org.backTo", { name: org.name })}
            </a>
          ) : null}
          <a href={localeHref(locale, "/")} className="inline-flex min-h-11 items-center text-lg font-bold" data-site-brand="">
            {t.t("ui.site.name")}
          </a>
          <HeaderMenu label={t.t("a11y.menu")}>
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
          {followPathname ? <FollowingLanguageMenu items={links} label={t.t("a11y.languageMenu")} /> : <LanguageMenu items={links} label={t.t("a11y.languageMenu")} />}
          {headerRight ?? <HeaderRightOutlet />}
          </HeaderMenu>
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
  const org = orgLink();
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
        {org ? (
          <p>
            <a href={org.href} data-org-link="footer" className="inline-flex min-h-11 items-center underline">
              {t.t("ui.org.backTo", { name: org.name })}
            </a>
          </p>
        ) : null}
        <nav aria-label={t.t("about.nav.label")}>
          <ul className="flex flex-wrap gap-x-6">
            {(["data-sources", "privacy", "terms", "contact"] as const).map((page) => (
              <li key={page}>
                <a href={aboutHref(locale, page)} className="inline-flex min-h-11 items-center underline">
                  {t.t(`about.nav.${page === "data-sources" ? "dataSources" : page}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
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
