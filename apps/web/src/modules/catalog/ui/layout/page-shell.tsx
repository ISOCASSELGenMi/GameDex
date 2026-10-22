/**
 * 每頁共用的 header＋<main>。語言選單需要「目前路徑與 query」，只有頁面知道，所以 header 由頁面渲染
 * （版面不讀 pathname／searchParams，維持可快取）。頁尾署名在 [locale] 版面（SiteFooter）。
 *
 * Header（Holodex 式，桌機與手機一致）：左＝品牌＋導覽下拉；中＝搜尋框（窄螢幕縮成圖示）；右＝主題、語言、帳號三個下拉。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { visibleThemeOptions } from "@/kernel/ui/theme";
import { getTranslator } from "../labels";
import { aboutHref, gamesBrowseHref, languageMenuLinks, localeHref, subscribeHref, type LocalPath } from "../links";
import { searchBoxLabels } from "../search/labels";
import { HeaderSearch } from "../search/header-search";
import { HeaderRightOutlet } from "./header-right";
import { FollowingLanguageMenu } from "./following-language-menu";
import { LanguageMenu } from "./language-menu";
import { FollowingNavMenu, NavMenu } from "./nav-menu";
import { brandOfPath, DEFAULT_BRAND, navItems } from "./nav-items";
import { orgLink } from "./org-link";
import { ThemeMenu } from "./theme-menu";

export interface PageShellProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  /** 去掉語系前綴的路徑，例如 `/calendar/2026-10`。 */
  path: LocalPath;
  /** 語言選單保留的 query（不含 ?）。 */
  query?: string;
  /** true＝語言選單與導覽的「目前頁」跟著客戶端的網址走（跨頁共用的版面用，例如帳號頁殼）。 */
  followPathname?: boolean;
  /** header 右側 slot（02：`header.right`，accounts 的帳號按鈕）；由根版面經 HeaderRightProvider 提供時不必傳（預設 <HeaderRightOutlet />）。 */
  headerRight?: ReactNode;
  children: ReactNode;
}

export function PageShell({ locale, supportedLocales, path, query = "", followPathname = false, headerRight, children }: PageShellProps): ReactElement {
  const t = getTranslator(locale);
  const links = languageMenuLinks(locale, supportedLocales, path, query);
  const org = orgLink();
  // 導覽項目是單一陣列（nav-items.ts）。aria-current 依路徑判斷：
  // /games 只在瀏覽頁本身為 current（遊戲詳情 /games/{slug} 不標），其餘依路徑前綴。
  const items = navItems(locale, t);
  const navProps = {
    items,
    label: t.t("a11y.menu"),
    navLabel: t.t("a11y.mainNavigation"),
    footer: org ? (
      <a href={org.href} data-org-link="menu" className="dd-item hd-org-menu">
        {t.t("ui.org.backTo", { name: org.name })}
      </a>
    ) : null,
  };
  const themeOptions = visibleThemeOptions().map((o) => ({ id: o.id, label: t.t(`ui.theme.${o.labelKey}`) }));
  const languageProps = { items: links, label: t.t("a11y.languageMenu"), triggerLabel: t.t("a11y.languageMenu") };
  return (
    <>
      <header className="site-header">
        <div className="hd-bar">
          <div className="hd-left">
            {org ? (
              <a href={org.href} data-org-link="header" className="link-quiet hd-org">
                {t.t("ui.org.backTo", { name: org.name })}
              </a>
            ) : null}
            <a href={localeHref(locale, "/")} className="hd-brand" data-site-brand="">
              <span className="hd-brand-text" lang="en">
                {followPathname ? DEFAULT_BRAND : brandOfPath(path)}
              </span>
            </a>
            {followPathname ? <FollowingNavMenu {...navProps} /> : <NavMenu {...navProps} currentPath={path} />}
          </div>
          <HeaderSearch
            locale={locale}
            action={gamesBrowseHref(locale)}
            labels={searchBoxLabels(t)}
            placeholder={t.t("ui.search.placeholder")}
            ariaLabel={t.t("ui.search.label")}
            formLabel={t.t("ui.search.siteLabel")}
            submitLabel={t.t("ui.search.submit")}
            openLabel={t.t("ui.search.open")}
            closeLabel={t.t("ui.search.close")}
          />
          <div className="hd-right">
            <ThemeMenu label={t.t("ui.theme.menuLabel")} options={themeOptions} />
            {followPathname ? <FollowingLanguageMenu {...languageProps} /> : <LanguageMenu {...languageProps} />}
            {headerRight ?? <HeaderRightOutlet />}
          </div>
        </div>
        <noscript>
          <nav aria-label={t.t("a11y.mainNavigation")} className="hd-noscript">
            <ul>
              {items.map((item) => (
                <li key={item.path}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </noscript>
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
