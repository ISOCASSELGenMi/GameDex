/**
 * 首頁 `/[locale]`（GameDex 第 2 段；參考 IGDB 首頁）。伺服器元件，內容與使用者無關（可 CDN 快取）。
 * 區塊：即將上市、最新上市、近期活動、近期熱門；每區有「查看更多」。封面卡片橫向排列，窄螢幕在區塊內左右捲動。
 * 資料經 getHomeDashboard（聚合規則只有一份）；整份結果以 "use cache" 共用 5 分鐘（熱度每小時才重算）。
 * 版面骨架：玻璃質感、景深、動態等視覺語言由第 3 段統一套用。
 */
import Image from "next/image";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import type { ReactElement, ReactNode } from "react";
import { formatNumber, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import { EventTime } from "@/kernel/ui/event-time";
import type { EventListItem, HomeDashboard, HomeGameCard, TrendingCard } from "../../domain/entities";
import { HOME_EVENT_DAYS, HOME_RECENT_DAYS, HOME_UPCOMING_DAYS, addDaysIso } from "../../domain/home-dashboard";
import { utcToday } from "../../domain/utc-date";
import { getHomeDashboard } from "../../use-cases/read/get-home-dashboard";
import { platformChipText } from "../calendar/view-model";
import { eventStatusLabel } from "../events/view-model";
import { HeatBadge, HeatSprite, heatBadgeLabel } from "../heat-badge";
import { EventIcon } from "../icons";
import { eventKindLabel, getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { calendarTodayHref, eventHref, eventsHref, gameHref, gamesBrowseHref, timelineHref, trendingHref } from "../links";
import { gameNameLang } from "../name-lang";
import { rethrowForPage, timeoutMarkerOrRethrow, unwrapCachedForPage, type CachedTimeout } from "../page-errors";
import { searchBoxLabels } from "../search/labels";
import { SearchCombobox } from "../search/search-combobox";
import { websiteJsonLd } from "../seo/json-ld";
import { JsonLdScript } from "../seo/json-ld-script";
import { siteOrigin } from "../seo/site-url";
import { HomeEventsEmpty } from "./home-events-empty";
import { HomeTrendingTabs } from "./home-trending-tabs";

export function homeTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.home.metaTitle");
}
export function homeDescription(locale: Locale): string {
  return getTranslator(locale).t("ui.home.metaDescription");
}

async function readHomeCached(locale: string, today: string): Promise<HomeDashboard | CachedTimeout> {
  "use cache";
  try {
    // today 是快取鍵的一部分（跨日自動換一份）；資料以同一個「現在」計算
    const data = await getHomeDashboard({ locale, now: new Date(`${today}T12:00:00Z`) });
    cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
    return data;
  } catch (err) {
    const marker = timeoutMarkerOrRethrow(err);
    cacheLife("seconds");
    return marker;
  }
}

async function loadHome(locale: string): Promise<HomeDashboard> {
  try {
    return unwrapCachedForPage(await readHomeCached(locale, utcToday()));
  } catch (err) {
    rethrowForPage(err);
  }
}

/** 首頁卡片多（上限 48 張），火焰圖示共用一份 sprite。 */
const HEAT_SPRITE_ID = "home-heat-flame";
const ROW = "mt-3 flex list-none snap-x gap-3 overflow-x-auto p-0 pb-3";
const CARD_W = "w-36 shrink-0 snap-start sm:w-40";

function Cover({ cover, eager }: { cover: HomeGameCard["cover"]; eager: boolean }): ReactElement {
  return cover ? (
    <Image className="aspect-[3/4] w-full rounded-md object-cover" src={cover.medium} alt="" width={264} height={352} unoptimized loading={eager ? "eager" : "lazy"} />
  ) : (
    <span className="card-thumb-empty block aspect-[3/4] w-full rounded-md" aria-hidden="true" />
  );
}

interface SectionProps {
  id: string;
  title: string;
  hint?: string;
  moreHref: string;
  moreText: string;
  moreAria: string;
  children: ReactNode;
}

function Section({ id, title, hint, moreHref, moreText, moreAria, children }: SectionProps): ReactElement {
  const key = id.replace("home-", "");
  return (
    <section aria-labelledby={id} className="mt-8" data-home-section={key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-xl font-bold">
          {title}
        </h2>
        <a className="link inline-flex min-h-11 items-center" href={moreHref} aria-label={moreAria} data-home-more={key}>
          {moreText}
        </a>
      </div>
      {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
      {children}
    </section>
  );
}

function GameCardItem({ card, locale, t, eager }: { card: HomeGameCard; locale: Locale; t: Translator; eager: boolean }): ReactElement {
  const platforms = card.platforms.map(platformChipText).join(" · ");
  return (
    <li className={CARD_W} data-home-game={card.slug}>
      <a className="flex flex-col gap-1" href={gameHref(locale, card.slug)}>
        <Cover cover={card.cover} eager={eager} />
        <span className="line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere]" lang={gameNameLang(card.name, card.name === card.originalName, locale)}>
          {card.name}
        </span>
        <span className="text-xs text-[var(--muted)]">
          <time dateTime={card.date}>{formatReleaseLabel(card.date, card.precision, locale)}</time>
        </span>
        {platforms ? (
          <span className="text-xs text-[var(--muted)] [overflow-wrap:anywhere]">
            {platforms}
            {card.platformMore > 0 ? ` ${t.t("ui.home.platformMore", { count: card.platformMore })}` : ""}
          </span>
        ) : null}
        <HeatBadge level={card.heatLevel} label={heatBadgeLabel(t, card.heatLevel)} compact spriteId={HEAT_SPRITE_ID} />
      </a>
    </li>
  );
}

function TrendingItem({ item, rank, locale, t }: { item: TrendingCard; rank: number; locale: Locale; t: Translator }): ReactElement {
  return (
    <li className={CARD_W} data-home-game={item.slug}>
      <a className="flex flex-col gap-1" href={gameHref(locale, item.slug)}>
        <Cover cover={item.cover} eager={false} />
        <span className="text-xs font-bold text-[var(--muted)]">{t.t("ui.trending.rank", { rank })}</span>
        <span className="line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere]" lang={gameNameLang(item.name, item.name === item.originalName, locale)}>
          {item.name}
        </span>
        <span className="text-xs text-[var(--muted)]">{formatReleaseLabel(item.releaseDate, item.releasePrecision ?? "tbd", locale)}</span>
        <HeatBadge level={item.heatLevel} label={heatBadgeLabel(t, item.heatLevel)} compact spriteId={HEAT_SPRITE_ID} />
      </a>
    </li>
  );
}

function TrendingRow({ items, locale, t }: { items: readonly TrendingCard[]; locale: Locale; t: Translator }): ReactElement {
  if (items.length === 0) {
    return (
      <p className="mt-3" data-home-empty="">
        {t.t("ui.home.trending.empty")}
      </p>
    );
  }
  return (
    <ul className={ROW}>
      {items.map((c, i) => (
        <TrendingItem key={c.gameId} item={c} rank={i + 1} locale={locale} t={t} />
      ))}
    </ul>
  );
}

function EventCardItem({ item, locale, t }: { item: EventListItem; locale: Locale; t: Translator }): ReactElement {
  const status = eventStatusLabel(t, item.timeStatus);
  return (
    <li className="w-64 shrink-0 snap-start" data-home-event={item.slug}>
      <a className="flex h-full flex-col gap-2 rounded-lg border border-[var(--border)] p-3" href={eventHref(locale, item.slug)}>
        {item.logo ? (
          <Image src={item.logo.medium} alt="" width={284} height={160} unoptimized={!item.logo.resized} loading="lazy" className="h-20 w-full object-contain" />
        ) : (
          <span className="card-thumb-empty block h-20 w-full rounded-md" aria-hidden="true" />
        )}
        <span className="line-clamp-2 font-semibold [overflow-wrap:anywhere]" lang="en">
          {item.name}
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-2 text-sm text-[var(--muted)]">
          <EventIcon />
          <span>{eventKindLabel(t, item.kind)}</span>
          {status ? <span className="chip">{status}</span> : null}
        </span>
        <span className="text-sm text-[var(--muted)]">{item.startTime ? <EventTime startIso={item.startTime} endIso={item.endTime} locale={locale} /> : t.t("ui.events.timeTbd")}</span>
        {item.gameCount > 0 ? <span className="text-xs text-[var(--muted)]">{t.t("ui.events.gameCount", { count: formatNumber(item.gameCount, locale) })}</span> : null}
      </a>
    </li>
  );
}

export async function HomePage({ locale, supportedLocales }: { locale: Locale; supportedLocales: readonly Locale[] }): Promise<ReactElement> {
  await connection();
  const data = await loadHome(locale);
  const t = getTranslator(locale);
  const more = t.t("ui.home.more");
  const aria = (section: string) => t.t("ui.home.moreAria", { section });
  const titles = {
    upcoming: t.t("ui.home.upcoming.title"),
    recent: t.t("ui.home.recent.title"),
    events: t.t("ui.home.events.title"),
    trending: t.t("ui.home.trending.title"),
  };
  const empty = (text: string) => (
    <p className="mt-3" data-home-empty="">
      {text}
    </p>
  );

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/">
      <JsonLdScript data={websiteJsonLd(t.t("ui.site.name"), { origin: siteOrigin(), locale })} />
      <HeatSprite id={HEAT_SPRITE_ID} />
      <div className="py-4">
        <h1 className="text-3xl font-bold">{t.t("ui.site.name")}</h1>
        <p className="mt-1 text-[var(--muted)]">{t.t("ui.site.tagline")}</p>
        <form role="search" action={gamesBrowseHref(locale)} method="get" className="mt-4 flex max-w-xl gap-2">
          <label className="sr-only" htmlFor="home-search">
            {t.t("ui.home.searchLabel")}
          </label>
          <SearchCombobox
            locale={locale}
            id="home-search"
            placeholder={t.t("ui.home.searchPlaceholder")}
            labels={searchBoxLabels(t)}
            className="flex-1"
            inputClassName="min-h-8 text-sm w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3"
          />
          <button type="submit" className="btn-primary">
            {t.t("ui.home.searchButton")}
          </button>
        </form>
      </div>

      <Section id="home-upcoming" title={titles.upcoming} hint={t.t("ui.home.upcoming.hint", { days: HOME_UPCOMING_DAYS })} moreHref={calendarTodayHref(locale)} moreText={more} moreAria={aria(titles.upcoming)}>
        {data.upcoming.length === 0 ? (
          empty(t.t("ui.home.upcoming.empty"))
        ) : (
          <ul className={ROW}>
            {data.upcoming.map((c, i) => (
              <GameCardItem key={c.gameId} card={c} locale={locale} t={t} eager={i < 3} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="home-recent"
        title={titles.recent}
        hint={t.t("ui.home.recent.hint", { days: HOME_RECENT_DAYS })}
        moreHref={timelineHref(locale, {}, addDaysIso(data.today, -HOME_RECENT_DAYS))}
        moreText={more}
        moreAria={aria(titles.recent)}
      >
        {data.recent.length === 0 ? (
          empty(t.t("ui.home.recent.empty"))
        ) : (
          <ul className={ROW}>
            {data.recent.map((c) => (
              <GameCardItem key={c.gameId} card={c} locale={locale} t={t} eager={false} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="home-events" title={titles.events} hint={t.t("ui.home.events.hintWindow", { days: HOME_EVENT_DAYS })} moreHref={eventsHref(locale)} moreText={more} moreAria={aria(titles.events)}>
        {data.events.length === 0 ? (
          <HomeEventsEmpty t={t} />
        ) : (
          <ul className={ROW}>
            {data.events.map((e) => (
              <EventCardItem key={e.id} item={e} locale={locale} t={t} />
            ))}
          </ul>
        )}
      </Section>

      <HomeTrendingTabs
        title={titles.trending}
        tablistLabel={t.t("ui.trending.groupLabel")}
        tabLabels={{ upcoming: t.t("ui.trending.upcoming"), released: t.t("ui.trending.released") }}
        hints={{
          upcoming: `${t.t(`ui.trending.rankedBy.${data.trendingRankedBy}`)} ${t.t("ui.trending.upcomingHint")}`,
          released: `${t.t(`ui.trending.rankedBy.${data.trendingRankedBy}`)} ${t.t("ui.trending.releasedHint")}`,
        }}
        moreHrefs={{ upcoming: trendingHref(locale), released: trendingHref(locale, {}, "released") }}
        moreText={more}
        moreAria={{
          upcoming: aria(`${titles.trending} (${t.t("ui.trending.upcoming")})`),
          released: aria(`${titles.trending} (${t.t("ui.trending.released")})`),
        }}
        panels={{
          upcoming: <TrendingRow items={data.trending.upcoming} locale={locale} t={t} />,
          released: <TrendingRow items={data.trending.released} locale={locale} t={t} />,
        }}
      />
    </PageShell>
  );
}
