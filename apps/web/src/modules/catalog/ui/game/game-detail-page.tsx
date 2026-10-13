/**
 * 遊戲詳情頁 `/[locale]/games/[slug]`（06 §遊戲詳情頁；3a 範圍：評分區不顯示、平台純文字、無截圖區）。
 * 伺服器元件；找不到 → notFound()（回應開始前呼叫，真正的 404）。
 */
import Image from "next/image";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { cache, type ReactElement, type ReactNode } from "react";
import { formatDateTime, formatIsoDate, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { CalendarEventItem, GameDetail, GameFranchiseGroup, GameReleaseRow, GameSummary } from "../../domain/entities";
import { igdbImageUrl } from "../../domain/entities/cover-image";
import { getGameDetail } from "../../use-cases/read";
import { joinList } from "../calendar/view-model";
import { EventIcon, ExternalIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { eventKindLabel, genreLabel, getTranslator, regionLabel, stageLabel, statusLabel } from "../labels";
import { PageShell } from "../layout/page-shell";
import { gameHref } from "../links";
import { rethrowForPage } from "../page-errors";

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

/** generateMetadata 與頁面共用（React cache：同一請求只查一次）；找不到回 null。 */
export const loadGameDetail = cache(async (slug: string, locale: Locale): Promise<GameDetail | null> => {
  await connection();
  try {
    return await getGameDetail({ slug: safeDecode(slug), locale });
  } catch (err) {
    rethrowForPage(err);
  }
});

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
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

function SummaryCard({ game, locale, t }: { game: GameSummary; locale: Locale; t: Translator }): ReactElement {
  const label = game.firstReleasePrecision ? formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision, locale) : t.t("ui.releaseLabel.tbd");
  return (
    <a className="summary-card" href={gameHref(locale, game.slug)}>
      {game.coverImageId ? (
        <Image className="summary-thumb" src={igdbImageUrl(game.coverImageId, "t_cover_small")} alt="" width={90} height={128} unoptimized />
      ) : (
        <span className="summary-thumb card-thumb-empty" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{game.name}</span>
        <span className="text-sm text-[var(--muted)]">{label}</span>
      </span>
    </a>
  );
}

function SummaryList({ games, locale, t }: { games: readonly GameSummary[]; locale: Locale; t: Translator }): ReactElement {
  return (
    <ul className="summary-grid">
      {games.map((g) => (
        <li key={g.gameId}>
          <SummaryCard game={g} locale={locale} t={t} />
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
  return row.history.map((h) => {
    const from = formatReleaseLabel(h.oldDate, h.oldPrecision ?? "tbd", locale);
    const to = formatReleaseLabel(h.newDate, h.newPrecision ?? "tbd", locale);
    const change = t.t("ui.game.historyChange", { from, to });
    return h.changedAt
      ? t.t("ui.game.historyEntry", { change, date: t.t("ui.game.historyChangedAt", { date: formatIsoDate(h.changedAt.slice(0, 10), locale) }) })
      : change;
  });
}

function ReleaseRowView({ row, locale, t }: { row: GameReleaseRow; locale: Locale; t: Translator }): ReactElement {
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
            <span className="font-medium" lang="en">
              {e.name}
            </span>
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
  const linkLabel = (category: string) => {
    const key = `enums.linkCategory.${category}`;
    return t.has(key) ? t.t(key) : category;
  };
  const roleText = (roles: readonly string[]) => joinList(locale, roles.map((r) => t.t(`enums.gameCompanyRole.${r}`)));

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/games/${game.slug}`}>
      <article className="detail">
        <div className="detail-head">
          {game.coverImageId ? (
            <Image
              className="detail-cover"
              src={igdbImageUrl(game.coverImageId, "t_cover_big")}
              alt={game.name}
              width={264}
              height={374}
              sizes="(min-width: 768px) 264px, 50vw"
              priority
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-3xl font-bold">{game.name}</h1>
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
            </p>
            {game.platforms.length > 0 ? (
              <p>
                <span className="font-semibold">{t.t("ui.game.sections.platforms")}
                  {t.t("ui.common.colon")}
                </span>
                {joinList(locale, game.platforms.map((p) => p.name))}
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

        <Section id="sec-releases" title={t.t("ui.game.sections.releaseDates")}>
          {game.releaseGroups.length === 0 ? <p>{t.t("ui.game.noReleaseDates")}</p> : null}
          {game.releaseGroups.map((group) => (
            <div key={group.platform.slug} className="mt-3">
              <h3 className="font-semibold">{group.platform.name}</h3>
              <div className="overflow-x-auto">
                <table className="release-table">
                  <thead>
                    <tr>
                      <th scope="col">{t.t("ui.release.region")}</th>
                      <th scope="col">{t.t("ui.release.stage")}</th>
                      <th scope="col">{t.t("ui.release.date")}</th>
                      <th scope="col">{t.t("ui.release.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.releases.map((row) => (
                      <ReleaseRowView key={row.releaseEventId} row={row} locale={locale} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Section>

        {game.developers.length > 0 || game.publishers.length > 0 || game.companies.length > 0 ? (
          <Section id="sec-companies" title={t.t("ui.game.sections.companies")}>
            <ul className="flex flex-col gap-1">
              {game.companies.map((c) => (
                <li key={c.slug}>
                  <span className="font-medium">{c.name}</span> <span className="text-sm text-[var(--muted)]">{roleText(c.roles)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {game.links.length > 0 ? (
          <Section id="sec-links" title={t.t("ui.game.sections.links")}>
            <ul className="flex flex-wrap gap-2">
              {game.links.map((link) => (
                <li key={`${link.categoryLabel}:${link.url}`}>
                  <a className="ext-link" href={link.url} target="_blank" rel="noopener noreferrer">
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
            {f.games.length > 0 ? <SummaryList games={f.games} locale={locale} t={t} /> : <p>{t.t("ui.common.noData")}</p>}
          </Section>
        ))}

        {game.similarGames.length > 0 ? (
          <Section id="sec-similar" title={t.t("ui.game.sections.similar")}>
            <SummaryList games={game.similarGames} locale={locale} t={t} />
          </Section>
        ) : null}

        {game.dlcs.length > 0 ? (
          <Section id="sec-dlc" title={t.t("ui.game.sections.dlc")}>
            <SummaryList games={game.dlcs} locale={locale} t={t} />
          </Section>
        ) : null}

        {game.upcomingEvents.length > 0 ? (
          <Section id="sec-events" title={t.t("ui.game.sections.events")}>
            <EventList events={game.upcomingEvents} locale={locale} t={t} />
          </Section>
        ) : null}

        {slots?.sections}
      </article>
    </PageShell>
  );
}
