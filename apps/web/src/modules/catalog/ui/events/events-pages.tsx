/**
 * 活動列表 `/[locale]/events` 與活動詳情 `/[locale]/events/[slug]`（06 §活動）。伺服器元件。
 * 時間一律顯示 UTC 並標註；start_time 為 NULL＝「時間未定」。找不到 → notFound()；逾時 → 錯誤邊界。
 */
import Image from "next/image";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { cache, type ReactElement } from "react";
import { formatNumber, type Locale, type Translator } from "@sok/i18n";
import { EVENT_KINDS, type EventDetail, type EventList, type EventListItem } from "../../domain/entities";
import { getEventDetail } from "../../use-cases/read/get-event-detail";
import { listEvents } from "../../use-cases/read/list-events";
import { EntityGameList, LinkTabs, Pager } from "../entities/shared";
import { firstParam, safeDecode, type RawParam } from "../entities/view-model";
import { safeExternalUrl } from "../external-url";
import { EventIcon, ExternalIcon } from "../icons";
import { eventKindLabel, getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { eventHref, eventsHref } from "../links";
import { reportHref } from "../report/links";
import { rethrowForPage } from "../page-errors";
import { CATALOG_TAG, STATIC_SHELL_SLUG } from "../seo/cache-tags";
import { breadcrumbJsonLd, eventJsonLd } from "../seo/json-ld";
import { JsonLdScript } from "../seo/json-ld-script";
import { siteOrigin } from "../seo/site-url";
import { EVENTS_PAGE_SIZE, eventStatusLabel, eventTimeText, parseEventKind, parseEventScope, parseEventsPage } from "./view-model";

type SearchParamsRecord = Readonly<Record<string, RawParam>>;

export function eventsTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.events.title");
}

// ── 列表 ────────────────────────────────────────────────────────────────

const loadEventList = cache(async (scope: string, kind: string, page: number): Promise<EventList> => {
  await connection();
  try {
    return await listEvents({ scope, type: kind || null, page, pageSize: EVENTS_PAGE_SIZE });
  } catch (err) {
    rethrowForPage(err);
  }
});

function EventLogo({ item }: { item: EventListItem }): ReactElement {
  return item.logo ? (
    <Image
      src={item.logo.medium}
      alt=""
      width={284}
      height={160}
      unoptimized={!item.logo.resized}
      loading="lazy"
      style={{ width: "auto", height: "auto", maxWidth: 80, maxHeight: 45, objectFit: "contain", flex: "none" }}
    />
  ) : (
    <span className="card-thumb-empty" aria-hidden="true" style={{ width: 80, height: 45, flex: "none" }} />
  );
}

function EventRow({ item, locale, t }: { item: EventListItem; locale: Locale; t: Translator }): ReactElement {
  const status = eventStatusLabel(t, item.timeStatus);
  return (
    <li className="rounded-lg border border-[var(--border)] p-2" data-event={item.slug}>
      <a className="flex min-h-11 items-center gap-3" href={eventHref(locale, item.slug)}>
        <EventLogo item={item} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold [overflow-wrap:anywhere]" lang="en">
            {item.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
            <span className="ev-tag">
              <EventIcon />
              <span>{eventKindLabel(t, item.kind)}</span>
            </span>
            <span>{eventTimeText(item, locale, t)}</span>
            {status ? <span className="chip">{status}</span> : null}
            {item.gameCount > 0 ? <span>{t.t("ui.events.gameCount", { count: formatNumber(item.gameCount, locale) })}</span> : null}
          </span>
        </span>
      </a>
    </li>
  );
}

export async function EventsListPage({
  locale,
  supportedLocales,
  searchParams,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
}): Promise<ReactElement> {
  const scope = parseEventScope(firstParam(searchParams.when));
  const kind = parseEventKind(firstParam(searchParams.kind));
  const page = parseEventsPage(firstParam(searchParams.page));
  const data = await loadEventList(scope, kind ?? "", page);
  const t = getTranslator(locale);

  const scopeTabs = (["upcoming", "past", "undated"] as const).map((s) => ({
    key: s,
    href: eventsHref(locale, { kind: kind ?? undefined, when: s }),
    text: t.t(`ui.events.scope.${s}`),
    current: s === scope,
  }));
  const kindTabs = [
    { key: "all", href: eventsHref(locale, { when: scope }), text: t.t("ui.events.allKinds"), current: kind === null },
    ...EVENT_KINDS.map((k) => ({
      key: k,
      href: eventsHref(locale, { kind: k, when: scope }),
      text: eventKindLabel(t, k),
      current: kind === k,
    })),
  ];
  const query = [kind ? `kind=${kind}` : "", scope !== "upcoming" ? `when=${scope}` : "", page > 1 ? `page=${page}` : ""]
    .filter(Boolean)
    .join("&");

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/events" query={query}>
      <h1 className="text-2xl font-bold">{t.t("ui.events.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.events.timesInUtc")}</p>
      <LinkTabs label={t.t("ui.events.scopeLabel")} items={scopeTabs} />
      <LinkTabs label={t.t("ui.events.kindLabel")} items={kindTabs} />
      {scope === "undated" ? <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.events.undatedHint")}</p> : null}
      <p role="status" className="mt-2 text-sm text-[var(--muted)]">
        {t.t("ui.events.shown", { count: formatNumber(data.items.length, locale) })}
      </p>
      {data.items.length === 0 ? (
        <p className="mt-4">{t.t("ui.events.empty")}</p>
      ) : (
        <ul className="mt-3 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2" data-events="">
          {data.items.map((item) => (
            <EventRow key={item.id} item={item} locale={locale} t={t} />
          ))}
        </ul>
      )}
      <Pager
        t={t}
        page={page}
        hasMore={data.hasMore}
        hrefFor={(n) => eventsHref(locale, { kind: kind ?? undefined, when: scope, page: n })}
        label={t.t("ui.entities.pagination")}
      />
    </PageShell>
  );
}

// ── 詳情 ────────────────────────────────────────────────────────────────

/**
 * 快取層（同遊戲詳情：`use cache` 鍵含 slug、locale；找不到只短暫快取）。
 * timeStatus（upcoming／ongoing／past）由資料庫的 now() 在建立快取時算出，最多落後 catalogDetail.revalidate（1 小時）。
 */
async function readEventDetailCached(slug: string, locale: Locale): Promise<EventDetail | null> {
  "use cache";
  if (slug === STATIC_SHELL_SLUG) {
    cacheLife("catalogMiss");
    return null;
  }
  const ev = await getEventDetail({ slug: safeDecode(slug), locale });
  if (ev) {
    cacheLife("catalogDetail");
    cacheTag(CATALOG_TAG, `${CATALOG_TAG}:event`, `${CATALOG_TAG}:event:${ev.slug}`);
  } else {
    cacheLife("catalogMiss");
  }
  return ev;
}

export const loadEventDetail = cache(async (slug: string, locale: Locale): Promise<EventDetail | null> => {
  try {
    return await readEventDetailCached(slug, locale);
  } catch (err) {
    rethrowForPage(err);
  }
});

export async function eventPageTitle(slug: string, locale: Locale): Promise<string | null> {
  const data = await loadEventDetail(slug, locale);
  return data ? data.name : null;
}

export async function EventDetailPage({
  locale,
  supportedLocales,
  slug,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slug: string;
}): Promise<ReactElement> {
  const ev = await loadEventDetail(slug, locale);
  if (!ev) notFound();
  const t = getTranslator(locale);
  const status = eventStatusLabel(t, ev.timeStatus);
  const jsonLdCtx = { origin: siteOrigin(), locale };
  const stream = safeExternalUrl(ev.streamUrl);
  const site = safeExternalUrl(ev.url);
  const external = (href: string, text: string) => (
    <a className="ext-link" href={href} target="_blank" rel="noopener noreferrer">
      {text} <ExternalIcon />
      <span className="sr-only">{t.t("a11y.opensInNewWindow")}</span>
    </a>
  );

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/events/${ev.slug}`}>
      <JsonLdScript data={eventJsonLd(ev, jsonLdCtx)} />
      <JsonLdScript
        data={breadcrumbJsonLd(
          [{ name: t.t("ui.site.name"), path: "/" }, { name: t.t("ui.events.title"), path: "/events" }, { name: ev.name }],
          jsonLdCtx,
        )}
      />
      <nav aria-label={t.t("a11y.breadcrumb")} className="text-sm">
        <a className="link" href={eventsHref(locale)}>
          {t.t("ui.events.title")}
        </a>
      </nav>
      <article className="mt-2">
        <div className="flex flex-wrap items-center gap-4">
          {ev.logo ? (
            <Image
              src={ev.logo.medium}
              alt=""
              width={284}
              height={160}
              unoptimized={!ev.logo.resized}
              style={{ width: "auto", height: "auto", maxWidth: 160, maxHeight: 90, objectFit: "contain" }}
            />
          ) : null}
          <h1 className="text-3xl font-bold [overflow-wrap:anywhere]" lang="en">
            {ev.name}
          </h1>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-3">
          <span className="ev-tag">
            <EventIcon />
            <span>{eventKindLabel(t, ev.kind)}</span>
          </span>
          {status ? <span className="chip">{status}</span> : null}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-event-info="">
          <dt className="font-semibold">{t.t("ui.events.time")}</dt>
          <dd>
            {eventTimeText(ev, locale, t)}
            {ev.startTime ? null : <span className="block text-[var(--muted)]">{t.t("ui.events.undatedHint")}</span>}
          </dd>
          {ev.organizer ? (
            <>
              <dt className="font-semibold">{t.t("ui.events.organizer")}</dt>
              <dd lang="en">{ev.organizer}</dd>
            </>
          ) : null}
          {ev.series ? (
            <>
              <dt className="font-semibold">{t.t("ui.events.series")}</dt>
              <dd lang="en">{ev.series.name}</dd>
            </>
          ) : null}
        </dl>
        {ev.startTime ? <p className="mt-1 text-sm text-[var(--muted)]">{t.t("ui.events.timesInUtc")}</p> : null}
        {stream || site ? (
          <p className="mt-3 flex flex-wrap gap-2">
            {stream ? external(stream, t.t("ui.events.watch")) : null}
            {site ? external(site, t.t("ui.events.officialSite")) : null}
          </p>
        ) : null}
        <p className="mt-2">
          <a className="link inline-flex min-h-11 items-center" href={reportHref(locale, { kind: "event", slug: ev.slug })} rel="nofollow">
            {t.t("ui.report.entry.event")}
          </a>
        </p>
        {ev.description ? (
          <section className="mt-4" aria-labelledby="ev-desc">
            <h2 id="ev-desc" className="text-xl font-semibold">
              {t.t("ui.events.description")}
            </h2>
            <p className="text-sm text-[var(--muted)]">{t.t("ui.game.originalText")}</p>
            <p lang="en" className="whitespace-pre-line">
              {ev.description}
            </p>
          </section>
        ) : null}

        <section className="mt-6" aria-labelledby="ev-games">
          <h2 id="ev-games" className="text-xl font-semibold">
            {t.t("ui.common.withCount", { label: t.t("ui.events.relatedGames"), count: formatNumber(ev.gameCount, locale) })}
          </h2>
          {ev.games.length === 0 ? (
            <p className="mt-2">{t.t("ui.events.noGames")}</p>
          ) : (
            <>
              <EntityGameList items={ev.games} locale={locale} t={t} />
              {ev.gameCount > ev.games.length ? (
                <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.events.gamesTruncated", { count: ev.games.length })}</p>
              ) : null}
            </>
          )}
        </section>

        {ev.seriesEvents.length > 0 ? (
          <section className="mt-6" aria-labelledby="ev-series">
            <h2 id="ev-series" className="text-xl font-semibold">
              {t.t("ui.events.seriesEvents")}
            </h2>
            <ul className="mt-2 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
              {ev.seriesEvents.map((item) => (
                <EventRow key={item.id} item={item} locale={locale} t={t} />
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </PageShell>
  );
}
