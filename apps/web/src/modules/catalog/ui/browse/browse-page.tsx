/**
 * 遊戲瀏覽／搜尋頁 `/[locale]/games`（06 §瀏覽與搜尋）。伺服器元件。
 * - 搜尋框（role="search"）＋年份＋排序（只開放熱度／上市日期／名稱；名稱排序依原文，頁面標示）
 * - 共用篩選面板（遊戲層級維度）；已套用條件的 chip；空結果列出條件可逐一移除
 * - 分頁：上一頁／下一頁（不算總數）；offset ≤ BROWSE_OFFSET_MAX，頁面說明此限制
 * - 結果筆數：role="status" 的 live region
 */
import Form from "next/form";
import Image from "next/image";
import { connection } from "next/server";
import type { ReactElement } from "react";
import { FILTER_QUERY_MAX_LENGTH, filterSpecToQueryString, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatNumber, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import { BROWSE_OFFSET_MAX, BROWSE_PAGE_SIZE, type BrowseGameCard } from "../../domain/entities";
import { browseGames } from "../../use-cases/read";
import { loadFilterOptions } from "../calendar/filter-options";
import { collectFilterNotices, filterSpecToReadQuery, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, EmptyFilterResult, FilterNotices, FilterPanel } from "../filters/filter-panel";
import { HeatBadge, heatBadgeLabel } from "../heat-badge";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { gameHref, gamesBrowseHref, localeHref } from "../links";
import { rethrowForPage } from "../page-errors";
import {
  BROWSE_FILTER_FIELDS,
  BROWSE_SORT_OPTIONS,
  browseOffset,
  browsePagination,
  browseRange,
  hiddenFilterFields,
  parseBrowsePage,
  yearFieldValues,
} from "./view-model";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface GamesBrowsePageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
}

export function gamesTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.games.title");
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const inputClass = "min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]";

function GameCard({ game, locale, t }: { game: BrowseGameCard; locale: Locale; t: Translator }): ReactElement {
  const dateText = game.firstReleasePrecision ? formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision, locale) : t.t("ui.releaseLabel.tbd");
  const shown = game.platforms.slice(0, 4).map((p) => p.abbreviation ?? p.name);
  const platformText = shown.join(t.t("ui.common.listSeparator")) + (game.platforms.length > 4 ? ` +${game.platforms.length - 4}` : "");
  return (
    <li className="rounded-lg border border-[var(--border)]" data-browse-item={game.slug}>
      <a className="summary-card border-0" href={gameHref(locale, game.slug)}>
        {game.cover ? (
          <Image className="summary-thumb" src={game.cover.small} alt="" width={90} height={128} unoptimized loading="lazy" />
        ) : (
          <span className="summary-thumb card-thumb-empty" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold [overflow-wrap:anywhere]">{game.name}</span>
          {game.originalName !== game.name ? (
            <span className="text-sm text-[var(--muted)] [overflow-wrap:anywhere]" lang="en">
              {game.originalName}
            </span>
          ) : null}
          <span className="text-sm text-[var(--muted)]">{t.t("ui.common.labelValue", { label: t.t("ui.games.firstRelease"), value: dateText })}</span>
          {game.platforms.length > 0 ? <span className="text-sm text-[var(--muted)]">{platformText}</span> : null}
          <span className="flex flex-wrap items-center gap-1 text-sm">
            {game.gameType !== "main_game" ? <span className="chip">{t.t(`enums.gameType.${game.gameType}`)}</span> : null}
            {game.gameStatus === "rumored" ? <span className="chip">{t.t("enums.gameStatus.rumored")}</span> : null}
            <HeatBadge level={game.heatLevel} label={heatBadgeLabel(t, game.heatLevel)} />
          </span>
        </span>
      </a>
    </li>
  );
}

export async function GamesBrowsePage({ locale, supportedLocales, searchParams }: GamesBrowsePageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const pageNo = parseBrowsePage(first(searchParams.page));
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.browse);
  const pageSpec = filterSpecForPage(parsed.filter, "browse");
  const query = filterSpecToReadQuery(pageSpec);

  let result, options;
  try {
    [result, options] = await Promise.all([
      browseGames({
        filter: query.filter,
        yearFrom: query.yearFrom,
        yearTo: query.yearTo,
        q: query.q,
        sort: query.sort,
        offset: browseOffset(pageNo),
        limit: BROWSE_PAGE_SIZE,
        locale,
      }),
      loadFilterOptions(locale),
    ]);
  } catch (err) {
    rethrowForPage(err);
  }
  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    result.ignored,
  );
  const spec = withoutIgnored(pageSpec, notices);
  const basePath = localeHref(locale, "/games");
  const chips = appliedChips(spec, basePath, makeFilterLabeler(t, options));
  const sort = spec.sort ?? "popularity";
  const years = yearFieldValues(spec);
  const range = browseRange(result.offset, result.games.length);
  const pager = browsePagination(pageNo, result.hasMore);
  const shellQuery = [filterSpecToQueryString(spec), pageNo > 1 ? `page=${pageNo}` : ""].filter(Boolean).join("&");
  const panelHidden: Record<string, string | undefined> = {
    q: spec.q,
    sort: spec.sort,
    yearFrom: years.from || undefined,
    yearTo: years.to || undefined,
  };
  const hidden = hiddenFilterFields(spec, ["q", "sort", "year", "yearFrom", "yearTo"]);

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/games" query={shellQuery}>
      <h1 className="text-2xl font-bold">{t.t("ui.games.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.games.intro")}</p>

      <Form action={basePath} prefetch={false} role="search" aria-label={t.t("ui.games.searchLabel")} className="filter-form mt-3">
        {hidden.map((h) => (
          <input key={`${h.name}:${h.value}`} type="hidden" name={h.name} value={h.value} />
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="font-bold">{t.t("ui.games.searchLabel")}</span>
            <input
              type="search"
              name="q"
              defaultValue={spec.q ?? ""}
              maxLength={FILTER_QUERY_MAX_LENGTH}
              placeholder={t.t("ui.games.searchPlaceholder")}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t.t("ui.games.sortLabel")}</span>
            <select name="sort" defaultValue={sort} aria-describedby="browse-sort-note" className={inputClass}>
              {BROWSE_SORT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t.t(`filters.sortValues.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary">
            {t.t("ui.games.searchButton")}
          </button>
        </div>
        <p id="browse-sort-note" className="fieldset-sub">
          {t.t(`ui.games.sortNote.${sort}`)}
        </p>
        <fieldset aria-describedby="browse-year-hint">
          <legend>{t.t("ui.games.yearLegend")}</legend>
          <p id="browse-year-hint" className="fieldset-sub">
            {t.t("ui.games.yearHint")}
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span>{t.t("filters.dimensions.yearFrom")}</span>
              <input type="number" inputMode="numeric" name="yearFrom" min={1900} max={2200} defaultValue={years.from} className={`${inputClass} w-32`} />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t.t("filters.dimensions.yearTo")}</span>
              <input type="number" inputMode="numeric" name="yearTo" min={1900} max={2200} defaultValue={years.to} className={`${inputClass} w-32`} />
            </label>
          </div>
        </fieldset>
      </Form>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={basePath} />
        <FilterPanel locale={locale} t={t} options={options} spec={spec} action={basePath} fields={BROWSE_FILTER_FIELDS} hidden={panelHidden} clearHref={basePath} />
        <p role="status" className="text-sm text-[var(--muted)]">
          {range
            ? t.t("ui.games.resultsRange", { from: formatNumber(range.from, locale), to: formatNumber(range.to, locale) })
            : t.t("filters.resultsCount", { count: formatNumber(0, locale) })}
        </p>
      </div>

      {result.games.length === 0 ? (
        <>
          <EmptyFilterResult chips={chips} t={t} clearHref={basePath} emptyText={pageNo > 1 ? t.t("ui.games.otherPage") : t.t("ui.games.empty")} />
          {pageNo > 1 ? (
            <p className="mt-2">
              <a className="link" href={gamesBrowseHref(locale, spec)}>
                {t.t("ui.games.backToFirst")}
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <ul className="mt-4 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label={t.t("ui.games.listLabel")}>
          {result.games.map((g) => (
            <GameCard key={g.gameId} game={g} locale={locale} t={t} />
          ))}
        </ul>
      )}

      {pageNo > 1 || result.hasMore ? (
        <nav aria-label={t.t("ui.games.pagination")} className="mt-4">
          <ul className="flex flex-wrap items-center gap-3">
            {pager.prev ? (
              <li>
                <a className="btn-secondary" rel="prev" href={gamesBrowseHref(locale, spec, pager.prev)}>
                  {t.t("ui.games.prevPage")}
                </a>
              </li>
            ) : null}
            <li aria-current="page">{t.t("ui.games.page", { page: pageNo })}</li>
            {pager.next ? (
              <li>
                <a className="btn-secondary" rel="next" href={gamesBrowseHref(locale, spec, pager.next)}>
                  {t.t("ui.games.nextPage")}
                </a>
              </li>
            ) : null}
          </ul>
          {pager.limitReached ? <p className="mt-2 text-sm font-semibold">{t.t("ui.games.limitReached", { max: formatNumber(BROWSE_OFFSET_MAX, locale) })}</p> : null}
          <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.games.depthNote", { max: formatNumber(BROWSE_OFFSET_MAX, locale) })}</p>
        </nav>
      ) : null}
    </PageShell>
  );
}
