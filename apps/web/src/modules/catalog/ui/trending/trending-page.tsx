/**
 * 熱門榜頁 `/[locale]/trending`（06 §熱度顯示）。伺服器元件。
 * - 榜單：即將上市（含上市未滿 30 天）／已上市，以 `?group=released` 切換（預設 upcoming 不寫進網址）
 * - 篩選：平台、平台類型、類型（與月曆共用 FilterSpec 的子集）；分頁 `?page=n`（每頁 TRENDING_PAGE_SIZE）
 * - 快取：熱度每小時才重算，所以資料查詢以 "use cache" ＋ cacheLife(revalidate 900 秒＝15 分鐘) 包起來（同 filter-options.ts 做法）；
 *   頁面本身仍在每次請求時組裝（讀 searchParams），只有查詢結果被共用。頁面註明「熱度每小時更新、不是即時排名」。
 */
import { connection } from "next/server";
import { cacheLife } from "next/cache";
import type { ReactElement } from "react";
import { filterSpecToQueryString, isEmptyFilter, parseFilterSpec, type FilterSearchInput, type FilterSpec } from "@sok/api-contract";
import { formatNumber, formatReleaseLabel, type Locale } from "@sok/i18n";
import { utcToday } from "../../domain/utc-date";
import type { IgnoredFilterValue, PopularityGroup, TrendingPage } from "../../domain/entities";
import { getTrending } from "../../use-cases/read";
import { loadFilterOptions } from "../calendar/filter-options";
import { collectFilterNotices, filterSpecToReleaseFilter, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, EmptyFilterResult, FilterNotices, FilterPanel, TRENDING_FILTER_FIELDS } from "../filters/filter-panel";
import { HeatSprite, heatBadgeLabel } from "../heat-badge";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { gameHref, localeHref, trendingHref } from "../links";
import { gameNameLang } from "../name-lang";
import { PageNav } from "../page-nav";
import { rethrowForPage, timeoutMarkerOrRethrow, unwrapCachedForPage, type CachedTimeout } from "../page-errors";
import { TrendingList, type TrendingRow } from "./trending-list";
import { TRENDING_PAGE_MAX, TRENDING_PAGE_SIZE, parseTrendingGroup, parseTrendingPage } from "./params";

const HEAT_SPRITE_ID = "trending-heat-flame";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface TrendingViewPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
}

export function trendingTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.trending.title");
}

interface CachedTrending {
  page: TrendingPage;
  ignored: IgnoredFilterValue[];
}

/** 熱度每小時更新：同一組條件 15 分鐘內共用結果。參數都可序列化（快取鍵）。 */
async function readTrendingCached(
  locale: string,
  group: PopularityGroup,
  specJson: string,
  offset: number,
  today: string,
): Promise<CachedTrending | CachedTimeout> {
  "use cache";
  const spec = JSON.parse(specJson) as FilterSpec;
  try {
    const { ignored, ...page } = await getTrending({ group, filter: filterSpecToReleaseFilter(spec), locale, limit: TRENDING_PAGE_SIZE, offset, today });
    cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
    return { page, ignored };
  } catch (err) {
    // 逾時要在快取邊界內攔下（跨過邊界後型別會遺失，見 page-errors.ts）；其他錯誤原樣丟出
    const marker = timeoutMarkerOrRethrow(err);
    cacheLife("seconds");
    return marker;
  }
}

async function loadTrending(locale: string, group: PopularityGroup, specJson: string, offset: number, today: string): Promise<CachedTrending> {
  return unwrapCachedForPage(await readTrendingCached(locale, group, specJson, offset, today));
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function TrendingViewPage({ locale, supportedLocales, searchParams }: TrendingViewPageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const group = parseTrendingGroup(first(searchParams.group));
  const pageNo = parseTrendingPage(first(searchParams.page));
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.trending);
  const pageSpec = filterSpecForPage(parsed.filter, "trending");

  let data: CachedTrending, options;
  try {
    [data, options] = await Promise.all([
      loadTrending(locale, group, JSON.stringify(pageSpec), (pageNo - 1) * TRENDING_PAGE_SIZE, utcToday()),
      loadFilterOptions(locale),
    ]);
  } catch (err) {
    rethrowForPage(err);
  }
  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    data.ignored,
  );
  const spec = withoutIgnored(pageSpec, notices);
  const query = filterSpecToQueryString(spec);
  const basePath = localeHref(locale, "/trending");
  const groupQuery = group === "upcoming" ? "" : `group=${group}`;
  const clearHref = group === "upcoming" ? basePath : `${basePath}?${groupQuery}`;
  const chips = appliedChips(spec, basePath, makeFilterLabeler(t, options), groupQuery);
  const { items, offset, hasMore } = data.page;
  const rankedBy = data.page.rankedBy ?? "popularity";
  const shellQuery = [query, groupQuery, pageNo > 1 ? `page=${pageNo}` : ""].filter(Boolean).join("&");

  const rows: TrendingRow[] = items.map((it, i) => [
    it.slug,
    gameHref(locale, it.slug),
    it.cover?.small ?? "",
    it.name,
    gameNameLang(it.name, it.name === it.originalName, locale) ?? "",
    t.t("ui.common.labelValue", { label: t.t("ui.trending.releaseDate"), value: formatReleaseLabel(it.releaseDate, it.releasePrecision ?? "tbd", locale) }),
    it.heatLevel ?? 0,
    t.t("ui.trending.rank", { rank: offset + i + 1 }),
  ]);
  const heatLabels = [0, 1, 2, 3, 4, 5].map((n) => heatBadgeLabel(t, n));
  const groups: { id: PopularityGroup; label: string; hint: string }[] = [
    { id: "upcoming", label: t.t("ui.trending.upcoming"), hint: t.t("ui.trending.upcomingHint") },
    { id: "released", label: t.t("ui.trending.released"), hint: t.t("ui.trending.releasedHint") },
  ];

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/trending" query={shellQuery}>
      <h1 className="text-2xl font-bold">{t.t("ui.trending.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.trending.note")}</p>
      <p className="mt-1 text-sm text-[var(--muted)]" data-ranked-by={rankedBy}>
        {t.t(`ui.trending.rankedBy.${rankedBy}`)}
      </p>

      <nav aria-label={t.t("ui.trending.groupLabel")} className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <a
                className="btn-secondary aria-[current=page]:font-bold aria-[current=page]:underline"
                href={trendingHref(locale, spec, g.id)}
                aria-current={g.id === group ? "page" : undefined}
                title={g.hint}
              >
                {g.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-1 text-sm text-[var(--muted)]">{groups.find((g) => g.id === group)?.hint}</p>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={clearHref} />
        <FilterPanel locale={locale} t={t} options={options} spec={spec} action={basePath} fields={TRENDING_FILTER_FIELDS} hidden={{ group: group === "upcoming" ? undefined : group }} clearHref={clearHref} />
        <p role="status" className="text-sm text-[var(--muted)]">
          {t.t("filters.resultsCount", { count: formatNumber(items.length, locale) })}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyFilterResult chips={isEmptyFilter(spec) ? [] : chips} t={t} clearHref={clearHref} emptyText={t.t("ui.trending.empty")} />
      ) : (
        <>
          <HeatSprite id={HEAT_SPRITE_ID} />
          <TrendingList rows={rows} heatLabels={heatLabels} spriteId={HEAT_SPRITE_ID} />
        </>
      )}

      {pageNo > 1 || hasMore ? (
        <PageNav
          label={t.t("ui.trending.pagination")}
          prevHref={pageNo > 1 ? trendingHref(locale, spec, group, pageNo - 1) : null}
          nextHref={hasMore && pageNo < TRENDING_PAGE_MAX ? trendingHref(locale, spec, group, pageNo + 1) : null}
          prevText={t.t("ui.trending.prevPage")}
          nextText={t.t("ui.trending.nextPage")}
          pageText={t.t("ui.trending.page", { page: pageNo })}
        />
      ) : null}
    </PageShell>
  );
}
