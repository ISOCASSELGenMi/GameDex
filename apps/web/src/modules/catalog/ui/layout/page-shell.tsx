/**
 * 每頁共用的 header＋<main>。語言選單需要「目前路徑與 query」，只有頁面知道，所以 header 由頁面渲染
 * （版面不讀 pathname／searchParams，維持可快取）。頁尾署名在 [locale] 版面（SiteFooter）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { getTranslator } from "../labels";
import { languageMenuLinks, localeHref, type LocalPath } from "../links";
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
  // 主要導覽（3b：月曆、時間軸、熱門榜）。aria-current 依路徑前綴判斷。
  const navItems = [
    { path: "/calendar", label: t.t("ui.nav.calendar") },
    { path: "/timeline", label: t.t("ui.nav.timeline") },
    { path: "/trending", label: t.t("ui.nav.trending") },
  ];
  const isCurrent = (p: string) => path === p || path.startsWith(`${p}/`);
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
                    href={localeHref(locale, item.path)}
                    aria-current={isCurrent(item.path) ? "page" : undefined}
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
      <div className="mx-auto max-w-screen-2xl">
        <p>
          <a href="https://www.igdb.com/" lang="en" className="underline" rel="noopener noreferrer">
            {t.t("ui.footer.dataAttribution")}
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
