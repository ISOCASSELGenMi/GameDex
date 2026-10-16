/**
 * 平台總覽 `/[locale]/platforms` 與平台頁 `/[locale]/platforms/[slug]`（06 §路由）。伺服器元件。
 * 找不到（含 mobile 平台）→ notFound()；查詢逾時 → rethrowForPage（錯誤邊界）。
 */
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { cache, type ReactElement } from "react";
import { formatIsoDate, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { PlatformListItem, PlatformPage } from "../../domain/entities";
import { getPlatformPage } from "../../use-cases/read/get-platform-page";
import { listPlatforms } from "../../use-cases/read/list-platforms";
import { getTranslator, platformKindLabel, regionLabel } from "../labels";
import { PageShell } from "../layout/page-shell";
import { platformHref, platformsHref, subscribeHref } from "../links";
import { reportHref } from "../report/links";
import { rethrowForPage } from "../page-errors";
import { EntityActions, EntityGameList, EntityLogo, LinkTabs, Pager, type EntityActionsRenderer } from "./shared";
import {
  firstParam,
  pagingForPage,
  parsePageParam,
  parsePlatformSection,
  parsePlatformSort,
  safeDecode,
  type RawParam,
} from "./view-model";

export type EntitySearchParams = Readonly<Record<string, RawParam>>;

export function platformsTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.platforms.title");
}

// ── 總覽 ────────────────────────────────────────────────────────────────

function PlatformItemView({ p, locale, t }: { p: PlatformListItem; locale: Locale; t: Translator }): ReactElement {
  const meta: string[] = [];
  if (p.family) meta.push(p.family.name);
  if (p.generation != null) meta.push(t.t("ui.platforms.generation", { generation: p.generation }));
  if (p.status !== "active") meta.push(t.t(`enums.platformStatus.${p.status}`));
  return (
    <li className="rounded-lg border border-[var(--border)] p-2" data-platform={p.slug}>
      <a className="flex min-h-11 items-center gap-3" href={platformHref(locale, p.slug)}>
        {p.logo ? (
          <EntityLogo logo={p.logo} name={p.name} small />
        ) : (
          <span className="card-thumb-empty" aria-hidden="true" style={{ width: 64, height: 36, flex: "none" }} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold [overflow-wrap:anywhere]">{p.name}</span>
          {meta.length > 0 ? <span className="text-sm text-[var(--muted)]">{meta.join(" · ")}</span> : null}
        </span>
      </a>
    </li>
  );
}

export async function PlatformsOverviewPage({
  locale,
  supportedLocales,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
}): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  let groups;
  try {
    groups = await listPlatforms({ locale });
  } catch (err) {
    rethrowForPage(err);
  }
  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/platforms">
      <h1 className="text-2xl font-bold">{t.t("ui.platforms.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.platforms.note")}</p>
      {groups.length === 0 ? <p className="mt-4">{t.t("ui.platforms.empty")}</p> : null}
      {groups.map((g) => {
        const heading = t.t("ui.common.withCount", { label: platformKindLabel(t, g.kind), count: g.platforms.length });
        const list = (
          <ul className="mt-2 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3">
            {g.platforms.map((p) => (
              <PlatformItemView key={p.slug} p={p} locale={locale} t={t} />
            ))}
          </ul>
        );
        // other 類（瀏覽器、VR…）預設收合
        return g.kind === "other" ? (
          <details key={g.kind} className="mt-6" data-platform-kind={g.kind}>
            <summary className="cursor-pointer text-xl font-semibold">{heading}</summary>
            {list}
          </details>
        ) : (
          <section key={g.kind} className="mt-6" aria-labelledby={`pk-${g.kind}`} data-platform-kind={g.kind}>
            <h2 id={`pk-${g.kind}`} className="text-xl font-semibold">
              {heading}
            </h2>
            {list}
          </section>
        );
      })}
    </PageShell>
  );
}

// ── 平台頁 ──────────────────────────────────────────────────────────────

/** generateMetadata 與頁面共用（React cache：同一請求只查一次）。 */
export const loadPlatformPage = cache(
  async (slug: string, locale: Locale, section: string, sort: string, page: number): Promise<PlatformPage | null> => {
    await connection();
    try {
      return await getPlatformPage({ slug: safeDecode(slug), locale, section, sort, ...pagingForPage(page) });
    } catch (err) {
      rethrowForPage(err);
    }
  },
);

function parseParams(sp: EntitySearchParams) {
  return {
    section: parsePlatformSection(firstParam(sp.section)),
    sort: parsePlatformSort(firstParam(sp.sort)),
    page: parsePageParam(firstParam(sp.page)),
  };
}

export async function platformPageTitle(slug: string, locale: Locale, sp: EntitySearchParams): Promise<string | null> {
  const { section, sort, page } = parseParams(sp);
  const data = await loadPlatformPage(slug, locale, section, sort, page);
  return data ? data.platform.name : null;
}

function shellQuery(section: string, sort: string, page: number): string {
  const parts: string[] = [];
  if (section !== "upcoming") parts.push(`section=${section}`);
  if (sort !== "date") parts.push(`sort=${sort}`);
  if (page > 1) parts.push(`page=${page}`);
  return parts.join("&");
}

export async function PlatformDetailPage({
  locale,
  supportedLocales,
  slug,
  searchParams,
  renderActions,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slug: string;
  searchParams: EntitySearchParams;
  renderActions?: EntityActionsRenderer;
}): Promise<ReactElement> {
  const { section, sort, page } = parseParams(searchParams);
  const data = await loadPlatformPage(slug, locale, section, sort, page);
  if (!data) notFound();
  const t = getTranslator(locale);
  const p = data.platform;
  const hrefFor = (n: number, o: { section?: typeof section; sort?: typeof sort } = {}) =>
    platformHref(locale, p.slug, n, { section: o.section ?? section, sort: o.sort ?? sort });

  const info: { label: string; value: string }[] = [
    { label: t.t("ui.platforms.kind"), value: platformKindLabel(t, p.kind) },
    { label: t.t("ui.platforms.status"), value: t.t(`enums.platformStatus.${p.status}`) },
  ];
  if (p.family) info.push({ label: t.t("ui.platforms.family"), value: p.family.name });
  if (p.generation != null) info.push({ label: t.t("ui.platforms.generationLabel"), value: String(p.generation) });
  if (p.alternativeName) info.push({ label: t.t("ui.platforms.alternativeName"), value: p.alternativeName });
  if (p.discontinuedOn) {
    info.push({ label: t.t("ui.platforms.discontinued"), value: formatIsoDate(p.discontinuedOn, locale, { dateStyle: "long" }) });
  }

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/platforms/${p.slug}`} query={shellQuery(section, sort, page)}>
      <nav aria-label={t.t("a11y.breadcrumb")} className="text-sm">
        <a className="link" href={platformsHref(locale)}>
          {t.t("ui.platforms.title")}
        </a>
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <EntityLogo logo={p.logo} name={p.name} />
        <h1 className="text-3xl font-bold [overflow-wrap:anywhere]">{p.name}</h1>
      </div>
      <EntityActions render={renderActions} target={{ targetType: "platform", targetId: p.id, slug: p.slug }} />
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-platform-info="">
        {info.map((row) => (
          <div key={row.label} className="contents">
            <dt className="font-semibold">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 flex flex-wrap gap-x-6">
        <a className="link inline-flex min-h-11 items-center" href={`${subscribeHref(locale)}?platform=${encodeURIComponent(p.slug)}#feed-platform`} data-action="subscribe-platform">
          {t.t("ui.platforms.subscribeFeed")}
        </a>
        <a className="link inline-flex min-h-11 items-center" href={reportHref(locale, { kind: "platform", slug: p.slug })} rel="nofollow">
          {t.t("ui.report.entry.platform")}
        </a>
      </p>
      {p.summary ? (
        <section className="mt-4" aria-labelledby="pf-summary">
          <h2 id="pf-summary" className="text-xl font-semibold">
            {t.t("ui.platforms.summary")}
          </h2>
          <p className="text-sm text-[var(--muted)]">{t.t("ui.game.originalText")}</p>
          <p lang="en" className="whitespace-pre-line">
            {p.summary}
          </p>
        </section>
      ) : null}

      {p.releaseDates.length > 0 ? (
        <section className="mt-4" aria-labelledby="pf-dates">
          <h2 id="pf-dates" className="text-xl font-semibold">
            {t.t("ui.platforms.releaseDates")}
          </h2>
          <ul className="mt-1 flex flex-col gap-1">
            {p.releaseDates.map((r, i) => (
              <li key={`${r.regionCode}-${i}`}>
                {regionLabel(t, r.regionCode)}
                {t.t("ui.common.colon")}
                {formatReleaseLabel(r.date, "day", locale)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6" aria-labelledby="pf-games">
        <h2 id="pf-games" className="text-xl font-semibold">
          {t.t("ui.platforms.gamesTitle")}
        </h2>
        <LinkTabs
          label={t.t("ui.platforms.sectionLabel")}
          items={[
            { key: "upcoming", href: hrefFor(1, { section: "upcoming" }), text: t.t("ui.platforms.upcoming"), current: section === "upcoming" },
            { key: "recent", href: hrefFor(1, { section: "recent" }), text: t.t("ui.platforms.recent"), current: section === "recent" },
          ]}
        />
        <LinkTabs
          label={t.t("ui.platforms.sortLabel")}
          items={[
            { key: "date", href: hrefFor(1, { sort: "date" }), text: t.t("ui.platforms.sortDate"), current: sort === "date" },
            { key: "popularity", href: hrefFor(1, { sort: "popularity" }), text: t.t("ui.platforms.sortPopularity"), current: sort === "popularity" },
          ]}
        />
        <p className="mt-2 text-sm text-[var(--muted)]">
          {section === "recent" ? t.t("ui.platforms.recentHint") : t.t("ui.platforms.upcomingHint")}
        </p>
        <p role="status" className="mt-1 text-sm text-[var(--muted)]">
          {t.t("ui.entities.shownOnPage", { count: data.games.items.length })}
        </p>
        {data.games.items.length === 0 ? (
          <p className="mt-4">{section === "recent" ? t.t("ui.platforms.emptyRecent") : t.t("ui.platforms.emptyUpcoming")}</p>
        ) : (
          <EntityGameList items={data.games.items} locale={locale} t={t} />
        )}
        <Pager t={t} page={page} hasMore={data.games.hasMore} hrefFor={(n) => hrefFor(n)} label={t.t("ui.entities.pagination")} />
      </section>
    </PageShell>
  );
}
