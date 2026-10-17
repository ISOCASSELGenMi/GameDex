/**
 * 月曆頁 `/[locale]/calendar/[yyyy-mm]`（06 §月曆、§篩選）。伺服器元件。
 *
 * 渲染策略：讀 DB 前 `await connection()`，整頁在回應前算完（不包 Suspense），
 * 所以格式錯的月份能回真正的 404。頁面內容只取決於（語系、月份、篩選 query），不讀 Cookie／標頭，
 * 「今天」由客戶端標示 → 之後可交給 ISR／CDN 快取（3.5）。
 */
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";
import { filterSpecToQueryString, isEmptyFilter, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatYearMonth, type Locale } from "@sok/i18n";
import { getCalendarMonth } from "../../use-cases/read";
import { regionPrefIssue } from "../../domain/release-filter";
import { collectFilterNotices, filterSpecToReadQuery, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, CALENDAR_FILTER_FIELDS, EmptyFilterResult, FilterNotices, FilterPanel } from "../filters/filter-panel";
import { getTranslator } from "../labels";
import type { PageSlots } from "../page-slots";
import { PageShell } from "../layout/page-shell";
import { calendarMonthHref, calendarMonthPath, calendarTodayHref, localeHref, searchParamsToQuery, timelineHref } from "../links";
import { addMonths, isoDate, monthOfDate, parseMonthParam, weekStartFor, type YearMonth } from "../month";
import { rethrowForPage } from "../page-errors";
import { CalendarInteractive } from "./calendar-interactive";
import { loadFilterOptions } from "./filter-options";
import { AgendaView, MonthGridView, UndatedView } from "./month-views";
import type { CalendarClientLabels } from "./types";
import { buildCalendarViewModel, type CardItem } from "./view-model";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface CalendarMonthPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  /** URL 的 `yyyy-mm` 區段（未驗證）。 */
  month: string;
  searchParams: SearchParamsRecord;
  /** 篩選區旁的連結、卡片動作（D83；薄路由從 UI slot 取得）。 */
  slots?: PageSlots;
}

/** `/[locale]/calendar`（無月份）與 `/[locale]`：導到「今天（UTC）」所在月份，保留 query。 */
export async function redirectToCurrentMonth(locale: Locale, searchParams: SearchParamsRecord): Promise<never> {
  await connection();
  const ym = monthOfDate(new Date());
  redirect(localeHref(locale, calendarMonthPath(ym), searchParamsToQuery(searchParams)));
}

export function calendarTitle(locale: Locale, ym: YearMonth): string {
  return getTranslator(locale).t("a11y.calendarGrid", { month: formatYearMonth(ym.year, ym.month, locale) });
}

export async function CalendarMonthPage({ locale, supportedLocales, month, searchParams, slots }: CalendarMonthPageProps): Promise<ReactElement> {
  const ym = parseMonthParam(month);
  if (!ym) notFound();
  await connection();

  const t = getTranslator(locale);
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  // 月曆不適用的參數（from／to、q、sort…）靜默略過，也不提示
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.calendar);
  const pageSpec = filterSpecForPage(parsed.filter, "calendar");
  const rq = filterSpecToReadQuery(pageSpec);
  let data, options;
  try {
    [data, options] = await Promise.all([
      getCalendarMonth({
        year: ym.year,
        month: ym.month,
        filter: rq.filter,
        regionPref: rq.regionPref,
        includeEvents: rq.show.events,
        locale,
      }),
      loadFilterOptions(locale),
    ]);
  } catch (err) {
    rethrowForPage(err);
  }
  // show=events（只看活動）：上市卡片不顯示
  if (!rq.show.releases) data = { ...data, days: {}, undated: [] };
  const regionIssue = regionPrefIssue(rq.regionPref);

  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    regionIssue ? [...data.ignored, regionIssue] : data.ignored,
  );
  const spec = withoutIgnored(pageSpec, notices);
  const query = filterSpecToQueryString(spec);
  const path = calendarMonthPath(ym);
  const basePath = localeHref(locale, path);
  const vm = buildCalendarViewModel(data, locale, t);
  const labeler = makeFilterLabeler(t, options);
  const chips = appliedChips(spec, basePath, labeler);
  const monthName = formatYearMonth(ym.year, ym.month, locale);
  const prev = addMonths(ym, -1);
  const next = addMonths(ym, 1);
  const hrefOf = (item: CardItem) => vm.previews[item.key]!.h;
  const empty = rq.show.releases ? vm.releaseCount === 0 : vm.eventCount === 0;

  const labels: CalendarClientLabels = {
    close: t.t("ui.common.close"),
    backToList: t.t("ui.calendar.backToList"),
    viewGame: t.t("ui.calendar.viewGame"),
    previewTitle: t.t("a11y.previewDialog"),
    dayDialogTitle: t.t("ui.calendar.dayListTitle"),
    platforms: t.t("ui.release.platforms"),
    date: t.t("ui.release.date"),
    stage: t.t("ui.release.stage"),
    status: t.t("ui.release.status"),
    originalName: t.t("ui.game.originalName"),
    sourceUnconfirmed: t.t("ui.release.sourceUnconfirmed"),
    event: t.t("ui.calendar.event"),
    release: t.t("ui.calendar.release"),
  };

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={path} query={query}>
      <div className="cal-header">
        <h1 id="cal-title" className="text-2xl font-bold">
          {calendarTitle(locale, ym)}
        </h1>
        <nav aria-label={t.t("ui.calendar.monthNavigation")}>
          <ul className="flex flex-wrap items-center gap-2">
            {prev ? (
              <li>
                <a
                  className="btn-secondary"
                  href={calendarMonthHref(locale, prev, spec)}
                  data-month-nav="prev"
                  aria-label={t.t("a11y.previousMonth", { month: formatYearMonth(prev.year, prev.month, locale) })}
                >
                  <span aria-hidden="true">{"← "}</span>
                  {t.t("ui.calendar.prevMonth")}
                </a>
              </li>
            ) : null}
            <li>
              <a className="btn-secondary" href={calendarTodayHref(locale, spec)}>
                {t.t("ui.calendar.today")}
              </a>
            </li>
            <li>
              <a className="btn-secondary" href={timelineHref(locale, filterSpecForPage(spec, "timeline"), isoDate(ym.year, ym.month, 1))}>
                {t.t("ui.timeline.viewAsTimeline")}
              </a>
            </li>
            {next ? (
              <li>
                <a
                  className="btn-secondary"
                  href={calendarMonthHref(locale, next, spec)}
                  data-month-nav="next"
                  aria-label={t.t("a11y.nextMonth", { month: formatYearMonth(next.year, next.month, locale) })}
                >
                  {t.t("ui.calendar.nextMonth")}
                  <span aria-hidden="true">{" →"}</span>
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        {!empty ? <AppliedFilterChips chips={chips} t={t} clearHref={basePath} /> : null}
        <FilterPanel locale={locale} t={t} options={options} spec={spec} action={basePath} fields={CALENDAR_FILTER_FIELDS} />
        {slots?.filterLinks}
        <p role="status" className="text-sm text-[var(--muted)]">
          {t.t("filters.resultsCount", { count: vm.releaseCount })}
        </p>
      </div>

      {empty ? <EmptyFilterResult chips={isEmptyFilter(spec) ? [] : chips} t={t} clearHref={basePath} emptyText={t.t("ui.calendar.noReleases")} /> : null}

      <CalendarInteractive key={`${path}?${query}`} previews={vm.previews} labels={labels}>
        <div className="cal-desktop">
          <MonthGridView ym={ym} locale={locale} t={t} vm={vm} hrefOf={hrefOf} weekStart={weekStartFor(locale)} titleId="cal-title" />
        </div>
        <div className="cal-mobile">
          <AgendaView ym={ym} locale={locale} t={t} vm={vm} hrefOf={hrefOf} />
        </div>
        <UndatedView locale={locale} t={t} groups={vm.undated} hrefOf={hrefOf} />
      </CalendarInteractive>
      {slots?.cardActions}
      {vm.eventCount > 0 ? <p className="mt-4 text-sm text-[var(--muted)]">{t.t("ui.calendar.timesInUtc")}</p> : null}
      <p className="sr-only">{monthName}</p>
    </PageShell>
  );
}
