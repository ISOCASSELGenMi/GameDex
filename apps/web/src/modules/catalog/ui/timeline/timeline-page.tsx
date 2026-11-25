/**
 * 時間軸頁 `/[locale]/timeline`（06 §時間軸、§篩選；GameDex 改版：垂直中軸、以「週」為單位）。伺服器元件。
 * 條件全在網址：篩選（與月曆共用 FilterSpec）、`week`（`2026-W43`，可分享）、`at`（跳到某日所在的週；舊版時間軸網址也可用）；
 * 舊版的 `cursor` 已不再使用（略過）。讀 DB 前 `await connection()`，整頁在回應前算完（同月曆）；
 * 「今天」＝UTC 日期。切週、同日多款的互動在客戶端元件 TimelineWeek。
 */
import { connection } from "next/server";
import type { ReactElement } from "react";
import {
  filterSpecToQueryString,
  parseFilterSpec,
  type FilterSearchInput,
  type FilterSpec,
} from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import { regionPrefIssue } from "../../domain/release-filter";
import { collectFilterNotices, withoutIgnored } from "../filter-mapping";
import {
  appliedChips,
  makeFilterLabeler,
  PAGE_FILTER_PARAMS,
} from "../filters/filter-labels";
import {
  AppliedFilterChips,
  FilterNotices,
  FilterPanel,
  WEEK_TIMELINE_FILTER_FIELDS,
} from "../filters/filter-panel";
import { LiveLink } from "../filters/live-link";
import { loadFilterOptions } from "../calendar/filter-options";
import { getTranslator, platformKindLabel } from "../labels";
import { PageShell } from "../layout/page-shell";
import type { PageSlots } from "../page-slots";
import { calendarMonthHref, localeHref } from "../links";
import { monthOfDate } from "../month";
import { rethrowForPage } from "../page-errors";
import { TimelineWeek } from "./timeline-week";
import { loadTimelineWeek, weekFilterSpec } from "./week-server";
import type { TimelineWeekLabels } from "./week-types";
import { filterSpecForPage } from "../filters/filter-labels";

export type SearchParamsRecord = Readonly<
  Record<string, string | string[] | undefined>
>;

export interface TimelineViewPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
  /** 篩選區旁的連結、卡片動作（D83；薄路由從 UI slot 取得）。 */
  slots?: PageSlots;
}

export function timelineTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.timeline.title");
}

function firstValue(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

export async function TimelineViewPage({
  locale,
  supportedLocales,
  searchParams,
  slots,
}: TimelineViewPageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(
    PAGE_FILTER_PARAMS.timeline.filter((p) => p !== "from" && p !== "to"),
  );
  const pageSpec = weekFilterSpec(parsed.filter);

  let loaded, options;
  try {
    [loaded, options] = await Promise.all([
      loadTimelineWeek({
        locale,
        spec: pageSpec,
        week: firstValue(searchParams.week),
        at: firstValue(searchParams.at),
      }),
      loadFilterOptions(locale),
    ]);
  } catch (err) {
    rethrowForPage(err);
  }
  const { data, ignored } = loaded;

  const regionIssue = regionPrefIssue(pageSpec.region);
  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    regionIssue ? [...ignored, regionIssue] : ignored,
  );
  const spec = withoutIgnored(pageSpec, notices);
  const query = filterSpecToQueryString(spec);
  const basePath = localeHref(locale, "/timeline");
  const labeler = makeFilterLabeler(t, options);
  const weekQuery = `week=${data.week}`;
  const chips = appliedChips(spec, basePath, labeler, weekQuery);
  const clearHref = localeHref(locale, "/timeline", weekQuery);
  const hiddenFilter = [...new URLSearchParams(query).entries()];
  const calendarMonth = monthOfDate(new Date(`${data.start}T00:00:00Z`));

  // 平台種類快速篩選（在週切換之上；與面板的「平台種類」同一個參數，切換時保留 week）
  const activeKinds = new Set<string>(spec.platformKind ?? []);
  const kindHref = (kind: string): string => {
    const next = new Set(activeKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    const nextSpec: FilterSpec = {
      ...spec,
      platformKind: [...next] as FilterSpec["platformKind"],
    };
    if (next.size === 0)
      delete (nextSpec as Record<string, unknown>).platformKind;
    return localeHref(
      locale,
      "/timeline",
      [filterSpecToQueryString(nextSpec), weekQuery].filter(Boolean).join("&"),
    );
  };

  const labels: TimelineWeekLabels = {
    prevWeek: t.t("ui.timeline.prevWeek"),
    nextWeek: t.t("ui.timeline.nextWeek"),
    today: t.t("ui.timeline.backToToday"),
    weekNavigation: t.t("ui.timeline.weekNavigation"),
    jumpTo: t.t("ui.timeline.jumpTo"),
    jumpGo: t.t("ui.timeline.jumpGo"),
    jumpHint: t.t("ui.timeline.jumpHint"),
    releasesCount: t.t("ui.timeline.releasesCount"),
    empty: t.t("ui.timeline.empty"),
    loading: t.t("ui.timeline.loading"),
    loadError: t.t("ui.timeline.loadError"),
    dayPrev: t.t("a11y.calendarPrevGame"),
    dayNext: t.t("a11y.calendarNextGame"),
    dayCurrent: t.t("a11y.calendarCurrentGame"),
    dayLoadError: t.t("ui.calendar.dayLoadError"),
    dayRetry: t.t("ui.calendar.dayRetry"),
    todayTag: t.t("a11y.today"),
  };
  const apiQuery = `locale=${locale}${query ? `&${query}` : ""}`;

  return (
    <PageShell
      locale={locale}
      supportedLocales={supportedLocales}
      path="/timeline"
      query={[query, weekQuery].filter(Boolean).join("&")}
    >
      <div className="cal-header">
        <h1 className="text-2xl font-bold">{t.t("ui.timeline.title")}</h1>
        <nav aria-label={t.t("ui.timeline.viewSwitch")}>
          <ul className="flex flex-wrap items-center gap-2">
            <li>
              <a
                className="btn-secondary"
                href={calendarMonthHref(
                  locale,
                  calendarMonth,
                  filterSpecForPage(spec, "calendar"),
                )}
              >
                {t.t("ui.timeline.viewAsCalendar")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {t.t("ui.timeline.description")}
      </p>

      <div className="cal-tools">
        <div className="tb-row tb-split">
          {options.platformKinds && options.platformKinds.length > 0 ? (
            <nav
              aria-label={t.t("filters.dimensions.platformKind")}
              className="tw-kinds"
              data-kind-filter=""
            >
              <ul>
                {options.platformKinds.map((k) => (
                  <li key={k}>
                    <LiveLink
                      className="tw-kind"
                      href={kindHref(k)}
                      aria-current={activeKinds.has(k) ? "true" : undefined}
                    >
                      {platformKindLabel(t, k)}
                    </LiveLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <FilterPanel
            locale={locale}
            t={t}
            options={options}
            spec={spec}
            action={basePath}
            fields={WEEK_TIMELINE_FILTER_FIELDS}
            hidden={{ week: data.week }}
            clearHref={clearHref}
          />
        </div>
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={clearHref} />
        {slots?.filterLinks}
      </div>

      <TimelineWeek
        key={`${query}|${data.week}`}
        initial={data}
        labels={labels}
        weekApiBase={`/api/v1/timeline/week?${apiQuery}`}
        dayApiBase={`/api/v1/calendar/day?${apiQuery}`}
        basePath={basePath}
        hiddenFilter={hiddenFilter}
      />
      {slots?.cardActions}
      <p className="mt-4 text-sm text-[var(--muted)]">
        {t.t("ui.timeline.timesInUtc")}
      </p>
    </PageShell>
  );
}
