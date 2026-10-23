/**
 * 評分排名頁 `/[locale]/ratings`（06 §評分排名；ui-direction「評分排名分頁」）。伺服器元件。
 * - 表格（RatingsTable，客戶端）：名次、遊戲、IGDB 分數（預設排序）、已啟用模組註冊的欄位（站內玩家平均…）；點欄位標題排序。
 * - 篩選沿用共用篩選面板（平台、類型、主題…）；另有排序欄／方向、最低票數、首發年份（面板內，沒有 JS 也能用）。
 * - 排序狀態在網址：`?sort=igdb|players&dir=desc&minVotes=10&page=2`（沒有參數＝IGDB 分數降冪、預設門檻、第 1 頁）。
 */
import { connection } from "next/server";
import type { ReactElement } from "react";
import { filterSpecToQueryString, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatNumber, intlLocale, type Locale } from "@sok/i18n";
import { RATING_MIN_VOTES_MAX } from "../../domain/entities";
import { parseRatingsParams, type RatingsRawParams } from "../../domain/ratings-ranking";
import { getRatingColumns, getRatingsRanking } from "../../use-cases/read";
import { yearFieldValues } from "../browse/view-model";
import { loadFilterOptions } from "../calendar/filter-options";
import { collectFilterNotices, filterSpecToReadQuery, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, FilterNotices, FilterPanel, type FilterField } from "../filters/filter-panel";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { localeHref, ratingsHref } from "../links";
import { rethrowForPage } from "../page-errors";
import { RatingsTable } from "./ratings-table";
import { ratingsQuery, toRankingResponse, type RatingsClientColumn } from "./view-model";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface RatingsPageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
}

export function ratingsTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.ratings.title");
}

const RATINGS_FILTER_FIELDS: readonly FilterField[] = ["platform", "platformKind", "genre", "theme", "type", "status"];

const inputClass = "min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]";

function has(sp: SearchParamsRecord, name: string): boolean {
  const v = sp[name];
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
}

export async function RatingsPage({ locale, supportedLocales, searchParams }: RatingsPageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const columns = getRatingColumns();
  const rp = parseRatingsParams(searchParams as RatingsRawParams, columns);
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.ratings);
  const pageSpec = filterSpecForPage(parsed.filter, "ratings");
  const rq = filterSpecToReadQuery(pageSpec);

  let result, options;
  try {
    [result, options] = await Promise.all([
      getRatingsRanking({
        filter: rq.filter,
        yearFrom: rq.yearFrom,
        yearTo: rq.yearTo,
        sort: rp.sort,
        dir: rp.dir,
        minVotes: rp.minVotes,
        page: rp.page,
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
  const filterQuery = filterSpecToQueryString(spec);
  const basePath = localeHref(locale, "/ratings");

  // 網址上明確給過的排序／方向／門檻會保留在 chip 移除、載入更多、語言切換的連結裡；預設值不寫
  const explicitSort = has(searchParams, "sort") || has(searchParams, "dir");
  const sortKeep = explicitSort ? { sort: result.sort, dir: result.dir } : {};
  const extraQuery = ratingsQuery({ filterQuery: "", ...sortKeep, minVotes: rp.minVotes });
  const shellQuery = ratingsQuery({ filterQuery, ...sortKeep, minVotes: rp.minVotes, page: rp.page });
  const chips = appliedChips(spec, basePath, makeFilterLabeler(t, options), extraQuery);
  const years = yearFieldValues(spec);

  const clientColumns: RatingsClientColumn[] = result.columns.map((c) => ({
    id: c.id,
    label: t.t(c.labelKey),
    countLabel: t.t(c.countLabelKey),
    scale: c.scale,
  }));
  const colLabel = (id: string) => clientColumns.find((c) => c.id === id)?.label ?? id;
  const dirText = (d: "asc" | "desc") => t.t(d === "desc" ? "ui.ratings.dirDesc" : "ui.ratings.dirAsc");
  const initial = toRankingResponse(result, rp.page, locale);
  const initialStatus = t.t("ui.ratings.status", {
    total: formatNumber(result.total, locale),
    column: colLabel(result.sort),
    direction: dirText(result.dir),
  });
  const moreHref = ratingsHref(
    locale,
    ratingsQuery({ filterQuery, ...sortKeep, minVotes: rp.minVotes, page: rp.page + 1 }),
  );
  const sortChoices = result.columns.map((c) => ({ id: c.id, label: t.t(c.labelKey) }));
  const thresholdColumn = colLabel(result.sort);

  const extraFields = (
    <>
      <fieldset aria-describedby="f-rsort-hint">
        <legend>{t.t("ui.ratings.sortLegend")}</legend>
        <p id="f-rsort-hint" className="fieldset-sub">
          {t.t("ui.ratings.sortHint")}
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            <span>{t.t("ui.ratings.sortBy")}</span>
            <select name="sort" defaultValue={result.sort} className={inputClass}>
              {sortChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{t.t("ui.ratings.direction")}</span>
            <select name="dir" defaultValue={result.dir} className={inputClass}>
              <option value="desc">{dirText("desc")}</option>
              <option value="asc">{dirText("asc")}</option>
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset aria-describedby="f-rvotes-hint">
        <legend>{t.t("ui.ratings.minVotesLegend")}</legend>
        <p id="f-rvotes-hint" className="fieldset-sub">
          {t.t("ui.ratings.minVotesHint", { column: thresholdColumn, default: formatNumber(result.defaultMinVotes, locale) })}
        </p>
        <label className="flex flex-col gap-1">
          <span>{t.t("ui.ratings.minVotesLabel", { column: thresholdColumn })}</span>
          <input
            type="number"
            inputMode="numeric"
            name="minVotes"
            min={0}
            max={RATING_MIN_VOTES_MAX}
            step={1}
            defaultValue={rp.minVotes ?? ""}
            placeholder={String(result.defaultMinVotes)}
            className={`${inputClass} w-32`}
          />
        </label>
      </fieldset>
      <fieldset aria-describedby="f-ryear-hint">
        <legend>{t.t("ui.games.yearLegend")}</legend>
        <p id="f-ryear-hint" className="fieldset-sub">
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
    </>
  );

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/ratings" query={shellQuery}>
      <h1 className="text-2xl font-bold">{t.t("ui.ratings.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.ratings.intro")}</p>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={basePath} />
        <FilterPanel
          locale={locale}
          t={t}
          options={options}
          spec={spec}
          action={basePath}
          fields={RATINGS_FILTER_FIELDS}
          clearHref={basePath}
          extraFields={extraFields}
          commonPlatformsOnly
        />
      </div>

      <RatingsTable
        key={shellQuery}
        locale={locale}
        numberLocale={intlLocale(locale)}
        columns={clientColumns}
        initial={initial}
        filterQuery={filterQuery}
        minVotesParam={rp.minVotes}
        gameBase={`${localeHref(locale, "/games")}/`}
        pagePath={basePath}
        initialStatus={initialStatus}
        explicitSort={explicitSort}
        strings={{
          caption: t.t("ui.ratings.caption"),
          regionLabel: t.t("ui.ratings.regionLabel"),
          rank: t.t("ui.ratings.rank"),
          game: t.t("ui.ratings.game"),
          noScore: t.t("ui.ratings.noScore"),
          status: t.t("ui.ratings.status"),
          dirDesc: dirText("desc"),
          dirAsc: dirText("asc"),
          loadMore: t.t("ui.common.loadMore"),
          loadMoreHref: moreHref,
          loadError: t.t("ui.ratings.loadError"),
          empty: t.t("ui.ratings.empty"),
          rankUp: t.t("ui.ratings.rankUp"),
          rankDown: t.t("ui.ratings.rankDown"),
          loaded: t.t("ui.ratings.loaded"),
        }}
      />
      <p className="mt-3 text-sm text-[var(--muted)]">{t.t("ui.ratings.note", { default: formatNumber(result.defaultMinVotes, locale) })}</p>
    </PageShell>
  );
}
