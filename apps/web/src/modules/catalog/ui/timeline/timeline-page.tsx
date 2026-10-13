/**
 * 時間軸頁 `/[locale]/timeline`（06 §時間軸、§篩選）。伺服器元件。
 * 條件全在網址：篩選（與月曆共用 FilterSpec）、`at`（跳到日期）、`cursor`（載入更多／較早；無 JS 的整頁導覽用）。
 * 讀 DB 前 `await connection()`，整頁在回應前算完（同月曆）；「今天」＝UTC 日期，時間軸以此畫「今天」線。
 */
import { connection } from "next/server";
import type { ReactElement } from "react";
import { filterSpecToQueryString, isEmptyFilter, isValidIsoDate, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatIsoDate, type Locale } from "@sok/i18n";
import { regionPrefIssue } from "../../domain/release-filter";
import { collectFilterNotices, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, EmptyFilterResult, FilterNotices, FilterPanel, TIMELINE_FILTER_FIELDS } from "../filters/filter-panel";
import { loadFilterOptions } from "../calendar/filter-options";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { calendarMonthHref, localeHref, timelineHref } from "../links";
import { monthOfDate } from "../month";
import { rethrowForPage } from "../page-errors";
import { loadTimelineChunk } from "./server";
import { TimelineList } from "./timeline-list";
import type { TimelineClientLabels } from "./types";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface TimelineViewPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
}

export function timelineTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.timeline.title");
}

function firstValue(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

export async function TimelineViewPage({ locale, supportedLocales, searchParams }: TimelineViewPageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.timeline);
  const pageSpec = filterSpecForPage(parsed.filter, "timeline");
  const cursor = firstValue(searchParams.cursor);
  const atRaw = firstValue(searchParams.at);
  const at = atRaw && isValidIsoDate(atRaw) ? atRaw : null;

  let loaded, options;
  try {
    [loaded, options] = await Promise.all([loadTimelineChunk({ locale, spec: pageSpec, cursor, at }), loadFilterOptions(locale)]);
  } catch (err) {
    rethrowForPage(err);
  }
  const { chunk, today, ignored } = loaded;

  const regionIssue = regionPrefIssue(pageSpec.region);
  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    regionIssue ? [...ignored, regionIssue] : ignored,
  );
  const spec = withoutIgnored(pageSpec, notices);
  const query = filterSpecToQueryString(spec);
  const basePath = localeHref(locale, "/timeline");
  const labeler = makeFilterLabeler(t, options);
  const chips = appliedChips(spec, basePath, labeler, at && !cursor ? `at=${encodeURIComponent(at)}` : "");
  const empty = chunk.groups.length === 0;
  const startsAtToday = !cursor && (at === null || at === today);
  const calendarMonth = monthOfDate(new Date(`${(!cursor && at) || today}T00:00:00Z`));
  const hiddenFilter = [...new URLSearchParams(query).entries()];

  const labels: TimelineClientLabels = {
    loadMore: t.t("ui.timeline.loadMore"),
    loadEarlier: t.t("ui.timeline.loadEarlier"),
    loading: t.t("ui.timeline.loading"),
    expand: t.t("ui.timeline.expand"),
    expandAria: t.t("ui.timeline.expandAria"),
    loadedCount: t.t("ui.timeline.loadedCount"),
    loadError: t.t("ui.timeline.loadError"),
    noEarlier: t.t("ui.timeline.noEarlier"),
    noLater: t.t("ui.timeline.noLater"),
    partialEarlier: t.t("ui.timeline.partialEarlier"),
    partialLater: t.t("ui.timeline.partialLater"),
    searchEarlier: t.t("ui.timeline.searchEarlier"),
    searchLater: t.t("ui.timeline.searchLater"),
    today: t.t("ui.timeline.today"),
    todayDate: t.t("ui.timeline.todayLine", { date: formatIsoDate(today, locale, { dateStyle: "long" }) }),
    history: t.t("ui.timeline.history"),
    historyLoading: t.t("ui.timeline.historyLoading"),
    historyError: t.t("ui.timeline.historyError"),
    historyEmpty: t.t("ui.timeline.historyEmpty"),
    sourceUnconfirmed: t.t("ui.release.sourceUnconfirmed"),
    platforms: t.t("ui.release.platforms"),
    listLabel: t.t("ui.timeline.title"),
  };

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/timeline" query={[query, at && !cursor ? `at=${encodeURIComponent(at)}` : ""].filter(Boolean).join("&")}>
      <div className="cal-header">
        <h1 className="text-2xl font-bold">{t.t("ui.timeline.title")}</h1>
        <nav aria-label={t.t("ui.timeline.viewSwitch")}>
          <ul className="flex flex-wrap items-center gap-2">
            <li>
              <a className="btn-secondary" href={calendarMonthHref(locale, calendarMonth, filterSpecForPage(spec, "calendar"))}>
                {t.t("ui.timeline.viewAsCalendar")}
              </a>
            </li>
            <li>
              <a className="btn-secondary" href={timelineHref(locale, spec)}>
                {t.t("ui.timeline.backToToday")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.timeline.description")}</p>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={at && !cursor ? timelineHref(locale, {}, at) : basePath} />
        <FilterPanel
          locale={locale}
          t={t}
          options={options}
          spec={spec}
          action={basePath}
          fields={TIMELINE_FILTER_FIELDS}
          hidden={{ at: at && !cursor ? at : undefined }}
          clearHref={at && !cursor ? timelineHref(locale, {}, at) : basePath}
        />
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-3" aria-label={t.t("ui.timeline.jumpTo")}>
          {hiddenFilter.map(([k, v]) => (
            <input key={`${k}=${v}`} type="hidden" name={k} value={v} />
          ))}
          <div className="flex flex-col gap-1">
            <label htmlFor="tl-at" className="font-bold">
              {t.t("ui.timeline.jumpTo")}
            </label>
            <input
              id="tl-at"
              type="date"
              name="at"
              defaultValue={at ?? ""}
              aria-describedby="tl-at-hint"
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]"
            />
          </div>
          <button type="submit" className="btn-primary">
            {t.t("ui.timeline.jumpGo")}
          </button>
          <p id="tl-at-hint" className="basis-full text-sm text-[var(--muted)]">
            {t.t("ui.timeline.jumpHint")}
          </p>
        </form>
      </div>

      {at && !cursor ? <p className="mt-2 text-sm">{t.t("ui.timeline.startsFrom", { date: formatIsoDate(at, locale, { dateStyle: "long" }) })}</p> : null}
      {empty ? <EmptyFilterResult chips={isEmptyFilter(spec) ? [] : chips} t={t} clearHref={basePath} emptyText={t.t("ui.timeline.empty")} /> : null}

      <TimelineList
        key={`${query}|${at ?? ""}|${cursor ?? ""}`}
        initial={chunk}
        labels={labels}
        locale={locale}
        path={basePath}
        baseQuery={query}
        today={today}
        startsAtToday={startsAtToday}
      />
      <p className="mt-4 text-sm text-[var(--muted)]">{t.t("ui.timeline.timesInUtc")}</p>
    </PageShell>
  );
}
