/**
 * 遊戲詳情頁 `/[locale]/games/[slug]`（06 §遊戲詳情頁；3a 範圍：平台純文字、無截圖區；Phase 4 加評分區）。
 * 伺服器元件；找不到 → notFound()（回應開始前呼叫，真正的 404）。
 */
import Image from "next/image";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { cache, type ReactElement, type ReactNode } from "react";
import { formatDateTime, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { CalendarEventItem, GameDetail, GameFranchiseGroup, GameReleaseRow, GameSummary, PlatformChip } from "../../domain/entities";
import { getGameDetail, getRatingDisplayConfig } from "../../use-cases/read";
import { joinList } from "../calendar/view-model";
import { safeDecode } from "../entities/view-model";
import { safeExternalUrl } from "../external-url";
import { followerCountLabel, HeatBadge, heatBadgeLabel, RisingMark } from "../heat-badge";
import { EventIcon, ExternalIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { eventKindLabel, genreLabel, getTranslator, regionLabel, stageLabel, statusLabel } from "../labels";
import { PageShell } from "../layout/page-shell";
import { companyHref, eventHref, franchiseHref, gameHref, icalFeedPath, platformHref } from "../links";
import { CATALOG_TAG, STATIC_SHELL_SLUG } from "../seo/cache-tags";
import { breadcrumbJsonLd, gameJsonLd } from "../seo/json-ld";
import { JsonLdScript } from "../seo/json-ld-script";
import { siteOrigin } from "../seo/site-url";
import { rethrowForPage, timeoutMarkerOrRethrow, unwrapCachedForPage, type CachedTimeout } from "../page-errors";
import { gameNameLang } from "../name-lang";
import { releaseHistoryText } from "../release-history";
import { reportHref } from "../report/links";
import { LanguageSupportBody } from "./language-support";
import { RatingsSection } from "./ratings-section";

export interface GameDetailSlots {
  /** `game.actions`（追蹤／收藏；accounts）。3a 沒有提供者。 */
  actions?: ReactNode;
  /** `game.sections`（頒獎、玩家評論）。3a 沒有提供者。 */
  sections?: ReactNode;
}

export interface GameDetailPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slug: string;
  slots?: GameDetailSlots;
}

/**
 * 快取層（06 §SEO 與快取：詳情頁 ISR 1~24 小時）。`use cache` 的快取鍵＝函式 ID＋引數（slug、locale），
 * 所以兩個語系各有自己的條目、不會互相污染。例外不快取（逾時等錯誤會原樣往外丟，由外層轉成頁面錯誤）。
 * 找不到（軟 404）只快取一下下，避免爬蟲掃不存在的 slug 每次都打 DB。
 */
async function readGameDetailCached(slug: string, locale: Locale): Promise<GameDetail | null | CachedTimeout> {
  "use cache";
  if (slug === STATIC_SHELL_SLUG) {
    cacheLife("catalogMiss");
    return null;
  }
  let game: GameDetail | null;
  try {
    game = await getGameDetail({ slug: safeDecode(slug), locale });
  } catch (err) {
    // 逾時要在快取邊界內攔下（跨過邊界後型別會遺失，見 page-errors.ts）；其他錯誤原樣丟出
    const marker = timeoutMarkerOrRethrow(err);
    cacheLife("seconds");
    return marker;
  }
  if (game) {
    cacheLife("catalogDetail");
    cacheTag(CATALOG_TAG, `${CATALOG_TAG}:game`, `${CATALOG_TAG}:game:${game.slug}`);
  } else {
    cacheLife("catalogMiss");
  }
  return game;
}

/** generateMetadata 與頁面共用（React cache：同一請求只呼叫一次）；找不到回 null。 */
export const loadGameDetail = cache(async (slug: string, locale: Locale): Promise<GameDetail | null> => {
  try {
    return unwrapCachedForPage(await readGameDetailCached(slug, locale));
  } catch (err) {
    rethrowForPage(err);
  }
});

/** 平台頁不含 mobile（P35）：mobile 平台只顯示文字。 */
function PlatformName({ platform, locale }: { platform: PlatformChip; locale: Locale }): ReactElement {
  if (platform.kind === "mobile") return <>{platform.name}</>;
  return (
    <a className="link" href={platformHref(locale, platform.slug)}>
      {platform.name}
    </a>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactElement {
  return (
    <section aria-labelledby={id} className="detail-section">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryCard({ game, locale }: { game: GameSummary; locale: Locale }): ReactElement {
  const label = formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision ?? "tbd", locale);
  return (
    <a className="summary-card" href={gameHref(locale, game.slug)}>
      {game.cover ? (
        <Image className="summary-thumb" src={game.cover.small} alt="" width={90} height={128} unoptimized />
      ) : (
        <span className="summary-thumb card-thumb-empty" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="font-medium" lang={gameNameLang(game.name, game.name === game.originalName, locale)}>
          {game.name}
        </span>
        <span className="text-sm text-[var(--muted)]">{label}</span>
      </span>
    </a>
  );
}

function SummaryList({ games, locale }: { games: readonly GameSummary[]; locale: Locale }): ReactElement {
  return (
    <ul className="summary-grid">
      {games.map((g) => (
        <li key={g.gameId}>
          <SummaryCard game={g} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

/** 系列與合集常是同一組作品（IGDB franchise／collection 同名）：作品完全相同的只顯示第一組。 */
function dedupeFranchises(groups: readonly GameFranchiseGroup[]): GameFranchiseGroup[] {
  const seen = new Set<string>();
  return groups.filter((g) => {
    const key = g.games.map((x) => x.gameId).sort((a, b) => a - b).join(",");
    if (key !== "" && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function historyText(row: GameReleaseRow, locale: Locale, t: Translator): string[] {
  return releaseHistoryText(row.history, locale, t);
}

function ReleaseRowView({ row, platformName, locale, t }: { row: GameReleaseRow; platformName: string; locale: Locale; t: Translator }): ReactElement {
  const history = historyText(row, locale, t);
  return (
    <tr>
      <td>{regionLabel(t, row.regionCode)}</td>
      <td>
        <StageIcon stage={row.stage} /> {stageLabel(t, row.stage)}
      </td>
      <td>
        {formatReleaseLabel(row.date, row.precision, locale)}
        {history.length > 0 ? (
          <details className="mt-1 text-sm">
            <summary>
              {t.t("ui.common.withCount", { label: t.t("ui.game.releaseHistory"), count: history.length })}
            </summary>
            <ol className="ml-4 list-decimal">
              {history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </td>
      <td>
        <span className={row.status === "cancelled" ? "status-cancelled" : undefined}>
          <StatusIcon status={row.status} /> {statusLabel(t, row.status)}
        </span>
        {row.sourceStatus === "removed" ? (
          <span className="card-warn mt-1 block">
            <WarningIcon /> {t.t("ui.release.sourceUnconfirmed")}
          </span>
        ) : null}
      </td>
      <td>
        <a
          className="link inline-flex min-h-11 items-center"
          href={reportHref(locale, { kind: "release_event", id: row.releaseEventId }, "wrong_date")}
          aria-label={t.t("ui.report.entry.rowFor", { platform: platformName, region: regionLabel(t, row.regionCode) })}
          rel="nofollow"
        >
          {t.t("ui.report.entry.row")}
        </a>
      </td>
    </tr>
  );
}

function EventList({ events, locale, t }: { events: readonly CalendarEventItem[]; locale: Locale; t: Translator }): ReactElement {
  return (
    <>
      <ul className="flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="ev-tag">
              <EventIcon />
              <span>{eventKindLabel(t, e.kind)}</span>
            </span>
            <a className="link font-medium" lang="en" href={eventHref(locale, e.slug)}>
              {e.name}
            </a>
            <span className="text-sm text-[var(--muted)]">
              {e.startTime ? formatDateTime(e.startTime, locale, "UTC") : t.t("ui.calendar.timeTbd")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.game.timesInUtc")}</p>
    </>
  );
}

export async function GameDetailPage({ locale, supportedLocales, slug, slots }: GameDetailPageProps): Promise<ReactElement> {
  const game = await loadGameDetail(slug, locale);
  if (!game) notFound();
  const t = getTranslator(locale);
  // 外部連結只放行 http(s)（唯一白名單 external-url.ts）；其餘不渲染成連結
  const safeLinks = game.links.flatMap((link) => {
    const href = safeExternalUrl(link.url);
    return href ? [{ link, href }] : [];
  });
  const linkLabel = (category: string) => {
    const key = `enums.linkCategory.${category}`;
    return t.has(key) ? t.t(key) : category;
  };
  const ratingConfig = getRatingDisplayConfig();
  const jsonLdCtx = { origin: siteOrigin(), locale, ratingConfig };
  const roleText = (roles: readonly string[]) => joinList(locale, roles.map((r) => t.t(`enums.gameCompanyRole.${r}`)));

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/games/${game.slug}`}>
      <JsonLdScript data={gameJsonLd(game, jsonLdCtx)} />
      <JsonLdScript
        data={breadcrumbJsonLd(
          [{ name: t.t("ui.site.name"), path: "/" }, { name: t.t("ui.games.title"), path: "/games" }, { name: game.name }],
          jsonLdCtx,
        )}
      />
      <article className="detail">
        <div className="detail-head">
          {game.cover ? (
            <Image
              className="detail-cover"
              src={game.cover.medium}
              alt={game.name}
              width={264}
              height={374}
              sizes="(min-width: 768px) 264px, 50vw"
              // 未知來源（resized=false）不在 images.remotePatterns 內：不經最佳化器、原樣載入
              unoptimized={!game.cover.resized}
              priority
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-3xl font-bold" lang={gameNameLang(game.name, game.name === game.originalName, locale)}>
              {game.name}
            </h1>
            {game.originalName !== game.name ? (
              <p className="text-[var(--muted)]">
                {t.t("ui.game.originalName")}
                {t.t("ui.common.colon")}
                <span lang="en">{game.originalName}</span>
              </p>
            ) : null}
            <p className="flex flex-wrap gap-2 text-sm">
              <span className="chip">{t.t(`enums.gameType.${game.gameType}`)}</span>
              {game.gameStatus ? <span className="chip">{t.t(`enums.gameStatus.${game.gameStatus}`)}</span> : null}
              <HeatBadge level={game.heatLevel} label={heatBadgeLabel(t, game.heatLevel)} />
            </p>
            {game.followerCount || game.rising ? (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-heat-follow="">
                {followerCountLabel(t, locale, game.followerCount) ? <span data-follower-count="">{followerCountLabel(t, locale, game.followerCount)}</span> : null}
                {game.rising ? <RisingMark label={t.t("ui.heat.rising")} /> : null}
              </p>
            ) : null}
            {game.platforms.length > 0 ? (
              <p>
                <span className="font-semibold">{t.t("ui.game.sections.platforms")}
                  {t.t("ui.common.colon")}
                </span>
                {game.platforms.map((p, i) => (
                  <span key={p.slug}>
                    {i > 0 ? t.t("ui.common.listSeparator") : null}
                    <PlatformName platform={p} locale={locale} />
                  </span>
                ))}
              </p>
            ) : null}
            {game.genres.length > 0 ? (
              <p>
                <span className="font-semibold">{t.t("ui.game.sections.genres")}
                  {t.t("ui.common.colon")}
                </span>
                {joinList(locale, game.genres.map((g) => genreLabel(t, g.slug, g.name)))}
              </p>
            ) : null}
            {game.ageRatingLabel ? <p>{t.t("ui.game.ageRating", { label: game.ageRatingLabel })}</p> : null}
            {game.parent ? (
              <p>
                <span className="font-semibold">{t.t("ui.game.parent")}
                  {t.t("ui.common.colon")}
                </span>
                <a className="link" href={gameHref(locale, game.parent.slug)}>
                  {game.parent.name}
                </a>
              </p>
            ) : null}
            <p>
              <a className="link inline-flex min-h-11 items-center" href={icalFeedPath(locale, "game", game.slug)} download data-action="download-ics">
                {t.t("ui.game.downloadIcs")}
                <span className="sr-only">{t.t("ui.common.parenthetical", { text: game.name })}</span>
              </a>
            </p>
            {slots?.actions ? <div className="flex flex-wrap gap-2">{slots.actions}</div> : null}
          </div>
        </div>

        {game.summary ? (
          <Section id="sec-overview" title={t.t("ui.game.sections.overview")}>
            <p className="text-sm text-[var(--muted)]">{t.t("ui.game.originalText")}</p>
            <p lang="en" className="whitespace-pre-line">
              {game.summary}
            </p>
          </Section>
        ) : null}

        <RatingsSection ratings={game.ratings} config={ratingConfig} locale={locale} t={t} />

        <Section id="sec-releases" title={t.t("ui.game.sections.releaseDates")}>
          {game.releaseGroups.length === 0 ? <p>{t.t("ui.game.noReleaseDates")}</p> : null}
          {game.releaseGroups.map((group) => (
            <div key={group.platform.slug} className="mt-3">
              <h3 id={`release-group-${group.platform.slug}`} className="font-semibold">
                <PlatformName platform={group.platform} locale={locale} />
              </h3>
              {/* 窄螢幕表格會水平溢出：可捲動區域要能用鍵盤聚焦（axe scrollable-region-focusable）。
                  relative：表頭的 sr-only（position:absolute）要以此為定位基準，否則表格溢出時會撐寬整頁 */}
              <div
                className="relative overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-labelledby={`release-group-${group.platform.slug}`}
              >
                <table className="release-table">
                  <thead>
                    <tr>
                      <th scope="col">{t.t("ui.release.region")}</th>
                      <th scope="col">{t.t("ui.release.stage")}</th>
                      <th scope="col">{t.t("ui.release.date")}</th>
                      <th scope="col">{t.t("ui.release.status")}</th>
                      <th scope="col">
                        <span className="sr-only">{t.t("ui.report.entry.column")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.releases.map((row) => (
                      <ReleaseRowView key={row.releaseEventId} row={row} platformName={group.platform.name} locale={locale} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="mt-3">
            <a className="link inline-flex min-h-11 items-center" href={reportHref(locale, { kind: "game", slug: game.slug }, "missing_region_date")} rel="nofollow">
              {t.t("ui.report.entry.addRegion")}
            </a>
          </p>
        </Section>

        {game.developers.length > 0 || game.publishers.length > 0 || game.companies.length > 0 ? (
          <Section id="sec-companies" title={t.t("ui.game.sections.companies")}>
            <ul className="flex flex-col gap-1">
              {game.companies.map((c) => (
                <li key={c.slug}>
                  <a className="link font-medium" href={companyHref(locale, c.slug)}>
                    {c.name}
                  </a>{" "}
                  <span className="text-sm text-[var(--muted)]">{roleText(c.roles)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {safeLinks.length > 0 ? (
          <Section id="sec-links" title={t.t("ui.game.sections.links")}>
            <ul className="flex flex-wrap gap-2">
              {safeLinks.map(({ link, href }) => (
                <li key={`${link.categoryLabel}:${link.url}`}>
                  <a className="ext-link" href={href} target="_blank" rel="noopener noreferrer">
                    {linkLabel(link.categoryLabel)}
                    <ExternalIcon />
                    <span className="sr-only">{t.t("a11y.externalLink")}</span>
                  </a>
                  {link.isBroken ? (
                    <span className="card-warn ml-1 text-sm">
                      <WarningIcon /> {t.t("ui.game.brokenLink")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {dedupeFranchises(game.franchises).map((f) => (
          <Section key={`${f.kind}:${f.slug}`} id={`sec-${f.kind}-${f.slug}`} title={t.t(`ui.game.franchiseTitle.${f.kind}`, { name: f.name })}>
            {f.games.length > 0 ? <SummaryList games={f.games} locale={locale} /> : <p>{t.t("ui.common.noData")}</p>}
            <p className="mt-2">
              <a className="link inline-flex min-h-11 items-center" href={franchiseHref(locale, f.slug, f.kind)}>
                {t.t("ui.games.viewAllFranchise", { name: f.name })}
              </a>
            </p>
          </Section>
        ))}

        {game.similarGames.length > 0 ? (
          <Section id="sec-similar" title={t.t("ui.game.sections.similar")}>
            <SummaryList games={game.similarGames} locale={locale} />
          </Section>
        ) : null}

        {game.dlcs.length > 0 ? (
          <Section id="sec-dlc" title={t.t("ui.game.sections.dlc")}>
            <SummaryList games={game.dlcs} locale={locale} />
          </Section>
        ) : null}

        {game.upcomingEvents.length > 0 ? (
          <Section id="sec-events" title={t.t("ui.game.sections.events")}>
            <EventList events={game.upcomingEvents} locale={locale} t={t} />
          </Section>
        ) : null}

        <Section id="sec-languages" title={t.t("ui.game.sections.languages")}>
          <LanguageSupportBody support={game.languageSupport} locale={locale} t={t} headingId="sec-languages" />
          <p className="mt-2">
            <a className="link inline-flex min-h-11 items-center" href={reportHref(locale, { kind: "game", slug: game.slug }, "language_support")} rel="nofollow">
              {t.t("ui.report.entry.addLanguage")}
            </a>
          </p>
        </Section>

        {slots?.sections}
      </article>
    </PageShell>
  );
}
