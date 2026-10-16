/**
 * 法務與說明頁 `/[locale]/about/{data-sources,privacy,terms,contact}`（16 §法務頁面）。伺服器元件，靜態內容、無 Cookie、可快取。
 * 文字在字典 `about` 命名空間（三語）。**內容是草稿，頁面上會明示「需專業人士審閱」**（見 about.draft）。
 * 段落格式：本文以換行分段；以「- 」開頭的連續行是項目清單；`https://` 開頭的字串自動變成連結。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { getTranslator } from "../labels";
import { aboutHref, gamesBrowseHref } from "../links";
import { PageShell } from "../layout/page-shell";

export const ABOUT_PAGES = ["data-sources", "privacy", "terms", "contact"] as const;
export type AboutPage = (typeof ABOUT_PAGES)[number];

export function isAboutPage(value: string): value is AboutPage {
  return (ABOUT_PAGES as readonly string[]).includes(value);
}

/** 字典鍵（about.<key>）與頁面內的段落順序。 */
const PAGE_KEY: Record<AboutPage, "dataSources" | "privacy" | "terms" | "contact"> = {
  "data-sources": "dataSources",
  privacy: "privacy",
  terms: "terms",
  contact: "contact",
};

const NAV_KEY: Record<AboutPage, string> = {
  "data-sources": "about.nav.dataSources",
  privacy: "about.nav.privacy",
  terms: "about.nav.terms",
  contact: "about.nav.contact",
};

const SECTIONS: Record<AboutPage, readonly string[]> = {
  "data-sources": ["igdb", "covers", "manual", "ratings", "accuracy", "corrections"],
  privacy: ["cookies", "storage", "logs", "reports", "feeds", "accounts", "accountVisibility", "accountRetention", "backups", "thirdParties", "changes"],
  terms: ["scope", "accuracy", "ip", "use", "reports", "links", "availability", "liability", "changes"],
  contact: ["general", "takedown", "privacy"],
};

/** 草稿最後修訂日（法律文件有實質修改時更新）。 */
export const ABOUT_DRAFT_DATE = "2026-10-17";

export function aboutTitle(locale: Locale, page: AboutPage): string {
  return getTranslator(locale).t(`about.${PAGE_KEY[page]}.title`);
}

const URL_RE = /(https?:\/\/[^\s]*[^\s.,;，。、；])/;

function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} className="link" href={part} rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** 本文 → 段落與項目清單。 */
function Body({ text }: { text: string }): ReactElement {
  const blocks: ReactElement[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="mt-2 list-disc space-y-1 pl-6">
        {items.map((it, i) => (
          <li key={i}>{linkify(it)}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      items.push(line.slice(2));
      continue;
    }
    flush();
    if (line.trim()) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="mt-2">
          {linkify(line)}
        </p>,
      );
    }
  }
  flush();
  return <>{blocks}</>;
}

export function AboutPageView({
  locale,
  supportedLocales,
  page,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  page: AboutPage;
}): ReactElement {
  const t = getTranslator(locale);
  const key = PAGE_KEY[page];
  const others = ABOUT_PAGES.filter((p) => p !== page);
  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/about/${page}`}>
      <article className="mx-auto max-w-3xl" data-about-page={page}>
        <h1 className="text-2xl font-bold">{t.t(`about.${key}.title`)}</h1>
        <aside className="notice mt-4" aria-labelledby="about-draft-title" data-section="draft">
          <h2 id="about-draft-title" className="font-bold">
            {t.t("about.draft.title")}
          </h2>
          <p className="mt-1">{t.t("about.draft.body")}</p>
          <p className="mt-1 text-sm">{t.t("about.updated", { date: ABOUT_DRAFT_DATE })}</p>
        </aside>
        <p className="mt-4">{t.t(`about.${key}.intro`)}</p>
        {SECTIONS[page].map((id) => (
          <section key={id} className="mt-6" aria-labelledby={`about-${id}`}>
            <h2 id={`about-${id}`} className="text-lg font-bold">
              {t.t(`about.${key}.sections.${id}.title`)}
            </h2>
            <Body text={t.t(`about.${key}.sections.${id}.body`)} />
          </section>
        ))}
        {page === "contact" ? (
          <p className="mt-4">
            <a className="btn-secondary" href={gamesBrowseHref(locale)}>
              {t.t("about.contact.findGame")}
            </a>
          </p>
        ) : null}
        <nav className="mt-8 border-t border-[var(--border)] pt-4" aria-labelledby="about-related">
          <h2 id="about-related" className="font-bold">
            {t.t("about.related")}
          </h2>
          <ul className="mt-1 flex flex-wrap gap-x-6">
            {others.map((p) => (
              <li key={p}>
                <a className="link inline-flex min-h-11 items-center" href={aboutHref(locale, p)}>
                  {t.t(NAV_KEY[p])}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </article>
    </PageShell>
  );
}
