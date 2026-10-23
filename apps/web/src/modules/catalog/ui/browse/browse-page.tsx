/**
 * 遊戲瀏覽／搜尋頁 `/[locale]/games`（06 §瀏覽與搜尋）。伺服器元件。
 * - 搜尋框（role="search"）＋年份＋排序（只開放熱度／上市日期／名稱；名稱排序依原文，頁面標示）
 * - 共用篩選面板（遊戲層級維度）；已套用條件的 chip；空結果列出條件可逐一移除
 * - 分頁：上一頁／下一頁（不算總數）；offset ≤ BROWSE_OFFSET_MAX，頁面說明此限制
 * - 結果筆數：role="status" 的 live region
 * - 分組檢視 `?by=date|platform|publisher`（預設 none＝上面的清單）：同一批遊戲（受搜尋與篩選限制）分成幾組，一頁 GAME_GROUPS_PER_PAGE 組（`page` 翻組），
 *   每組先送 GAME_GROUP_INITIAL 張卡，其餘「顯示更多」按需從 /api/v1/games/group 載入
 */
import Form from "next/form";
import Image from "next/image";
import { connection } from "next/server";
import type { ReactElement } from "react";
import { FILTER_QUERY_MAX_LENGTH, filterSpecToQueryString, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatNumber, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import { BROWSE_OFFSET_MAX, BROWSE_PAGE_SIZE, GAME_GROUP_BYS, type BrowseGameCard, type GameGroupBy } from "../../domain/entities";
import { browseGames } from "../../use-cases/read";
import { loadFilterOptions } from "../calendar/filter-options";
import { collectFilterNotices, filterSpecToReadQuery, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { AppliedFilterChips, EmptyFilterResult, FilterNotices, FilterPanel } from "../filters/filter-panel";
import { HeatBadge, heatBadgeLabel } from "../heat-badge";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import type { PageSlots } from "../page-slots";
import { gameHref, gamesBrowseHref, localeHref } from "../links";
import { gameNameLang } from "../name-lang";
import { PageNav } from "../page-nav";
import { rethrowForPage } from "../page-errors";
import { searchBoxLabels } from "../search/labels";
import { SearchCombobox } from "../search/search-combobox";
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
import { GroupCardList, GroupSwitch, GroupsProvider } from "./groups/groups-client";
import { groupApiBase, loadGameGroups, type GroupView } from "./groups/groups-server";
import { groupPagination, groupRange, isGrouped, parseGameGroupBy, parseGroupPage } from "./groups/params";

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export interface GamesBrowsePageProps {
  locale: Locale;
  supportedLocales: readonly Locale[];
  searchParams: SearchParamsRecord;
  /** 篩選區旁的連結（D83；薄路由從 UI slot 取得）。瀏覽頁不放卡片動作。 */
  slots?: Pick<PageSlots, "filterLinks">;
}

export function gamesTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.games.title");
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const inputClass = "min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]";

function GameCard({ game, locale, t }: { game: BrowseGameCard; locale: Locale; t: Translator }): ReactElement {
  const dateText = formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision ?? "tbd", locale);
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
          <span className="font-semibold [overflow-wrap:anywhere]" lang={gameNameLang(game.name, game.name === game.originalName, locale)}>
            {game.name}
          </span>
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

function GroupSection({ group, countText }: { group: GroupView; countText: string }): ReactElement {
  const headingId = `rc-h-${group.key}`;
  return (
    <section aria-labelledby={headingId} className="rc-group" data-rc-group={group.key}>
      <h2 id={headingId} className="rc-group-title">
        <span>{group.title}</span>
        <span className="rc-count">{countText}</span>
      </h2>
      <GroupCardList groupKey={group.key} total={group.total} cards={group.cards} />
    </section>
  );
}

export async function GamesBrowsePage({ locale, supportedLocales, searchParams, slots }: GamesBrowsePageProps): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const by: GameGroupBy = parseGameGroupBy(first(searchParams.by));
  const grouped = isGrouped(by);
  const pageNo = grouped ? parseGroupPage(first(searchParams.page)) : parseBrowsePage(first(searchParams.page));
  const parsed = parseFilterSpec(searchParams as FilterSearchInput);
  const pageParams = new Set<string>(PAGE_FILTER_PARAMS.browse);
  const pageSpec = filterSpecForPage(parsed.filter, "browse");
  const query = filterSpecToReadQuery(pageSpec);

  let result, groupsResult, options;
  try {
    [result, groupsResult, options] = await Promise.all([
      grouped
        ? Promise.resolve(null)
        : browseGames({
            filter: query.filter,
            yearFrom: query.yearFrom,
            yearTo: query.yearTo,
            q: query.q,
            sort: query.sort,
            offset: browseOffset(pageNo),
            limit: BROWSE_PAGE_SIZE,
            locale,
          }),
      grouped ? loadGameGroups({ locale, spec: pageSpec, by, page: pageNo }, t) : Promise.resolve(null),
      loadFilterOptions(locale),
    ]);
  } catch (err) {
    rethrowForPage(err);
  }
  const notices = collectFilterNotices(
    parsed.issues.filter((i) => pageParams.has(i.param)),
    result?.ignored ?? groupsResult?.ignored ?? [],
  );
  const spec = withoutIgnored(pageSpec, notices);
  const basePath = localeHref(locale, "/games");
  const extraQuery = grouped ? `by=${by}` : "";
  const chips = appliedChips(spec, basePath, makeFilterLabeler(t, options), extraQuery);
  const clearHref = localeHref(locale, "/games", extraQuery);
  const games = result?.games ?? [];
  const groups = groupsResult?.groups ?? [];
  const sort = spec.sort ?? "popularity";
  const years = yearFieldValues(spec);
  const range = result ? browseRange(result.offset, result.games.length) : null;
  const pager = result ? browsePagination(pageNo, result.hasMore) : groupPagination(pageNo, groupsResult?.hasMoreGroups ?? false);
  const groupsText = groupRange(pageNo, groups.length);
  const shellQuery = [filterSpecToQueryString(spec), extraQuery, pageNo > 1 ? `page=${pageNo}` : ""].filter(Boolean).join("&");
  const panelHidden: Record<string, string | undefined> = {
    q: spec.q,
    sort: spec.sort,
    yearFrom: years.from || undefined,
    yearTo: years.to || undefined,
  };
  const hidden = hiddenFilterFields(spec, ["q", "sort", "year", "yearFrom", "yearTo"]);
  if (grouped) {
    hidden.push({ name: "by", value: by });
    panelHidden.by = by;
  }
  const groupLabels = Object.fromEntries(GAME_GROUP_BYS.map((v) => [v, t.t(`ui.games.by.${v}`)])) as Record<GameGroupBy, string>;

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/games" query={shellQuery}>
      <h1 className="text-2xl font-bold">{t.t("ui.games.title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.games.intro")}</p>

      <Form action={basePath} prefetch={false} role="search" aria-label={t.t("ui.games.searchLabel")} className="filter-form mt-3">
        {hidden.map((h) => (
          <input key={`${h.name}:${h.value}`} type="hidden" name={h.name} value={h.value} />
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label htmlFor="browse-search" className="font-bold">
              {t.t("ui.games.searchLabel")}
            </label>
            <SearchCombobox
              locale={locale}
              id="browse-search"
              defaultValue={spec.q ?? ""}
              maxLength={FILTER_QUERY_MAX_LENGTH}
              placeholder={t.t("ui.games.searchPlaceholder")}
              labels={searchBoxLabels(t)}
              inputClassName={`${inputClass} w-full`}
            />
          </div>
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
        <AppliedFilterChips chips={chips} t={t} clearHref={clearHref} />
        <FilterPanel locale={locale} t={t} options={options} spec={spec} action={basePath} fields={BROWSE_FILTER_FIELDS} hidden={panelHidden} clearHref={clearHref} />
        {slots?.filterLinks}
        <div className="rc-nav">
          <GroupSwitch
            legend={t.t("ui.games.groupBy")}
            name="by"
            current={by}
            items={GAME_GROUP_BYS.map((value) => ({ value, label: groupLabels[value], href: gamesBrowseHref(locale, spec, 1, value) }))}
          />
          <noscript>
            <ul className="rc-noscript">
              {GAME_GROUP_BYS.map((value) => (
                <li key={value}>
                  <a className="link" href={gamesBrowseHref(locale, spec, 1, value)} aria-current={value === by ? "true" : undefined}>
                    {groupLabels[value]}
                  </a>
                </li>
              ))}
            </ul>
          </noscript>
        </div>
        <p role="status" className="text-sm text-[var(--muted)]">
          {grouped
            ? groupsText
              ? t.t("ui.games.groupsRange", { from: formatNumber(groupsText.from, locale), to: formatNumber(groupsText.to, locale) })
              : t.t("filters.resultsCount", { count: formatNumber(0, locale) })
            : range
              ? t.t("ui.games.resultsRange", { from: formatNumber(range.from, locale), to: formatNumber(range.to, locale) })
              : t.t("filters.resultsCount", { count: formatNumber(0, locale) })}
        </p>
        {grouped ? <p className="fieldset-sub">{t.t(`ui.games.groupNote.${by}`)}</p> : null}
      </div>

      {(grouped ? groups.length : games.length) === 0 ? (
        <>
          <EmptyFilterResult chips={chips} t={t} clearHref={clearHref} emptyText={pageNo > 1 ? t.t("ui.games.otherPage") : t.t("ui.games.empty")} />
          {pageNo > 1 ? (
            <p className="mt-2">
              <a className="link" href={gamesBrowseHref(locale, spec, 1, by)}>
                {t.t("ui.games.backToFirst")}
              </a>
            </p>
          ) : null}
        </>
      ) : grouped ? (
        <GroupsProvider
          key={`${by}|${pageNo}|${filterSpecToQueryString(spec)}`}
          endpoint={groupApiBase(locale, by, spec)}
          labels={{ more: t.t("ui.games.groupMore"), loading: t.t("ui.games.groupLoading"), error: t.t("ui.games.groupLoadError"), loaded: t.t("ui.games.groupLoaded") }}
        >
          <div className="rc-groups" role="group" aria-label={t.t("ui.games.groupsLabel")}>
            {groups.map((g) => (
              <GroupSection key={g.key} group={g} countText={t.t("ui.games.groupCount", { count: formatNumber(g.total, locale) })} />
            ))}
          </div>
        </GroupsProvider>
      ) : (
        <ul className="mt-4 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label={t.t("ui.games.listLabel")}>
          {games.map((g) => (
            <GameCard key={g.gameId} game={g} locale={locale} t={t} />
          ))}
        </ul>
      )}

      {pageNo > 1 || pager.next || pager.limitReached ? (
        <PageNav
          label={t.t("ui.games.pagination")}
          prevHref={pager.prev ? gamesBrowseHref(locale, spec, pager.prev, by) : null}
          nextHref={pager.next ? gamesBrowseHref(locale, spec, pager.next, by) : null}
          prevText={t.t("ui.games.prevPage")}
          nextText={t.t("ui.games.nextPage")}
          pageText={t.t("ui.games.page", { page: pageNo })}
        >
          {pager.limitReached ? <p className="mt-2 text-sm font-semibold">{t.t("ui.games.limitReached", { max: formatNumber(BROWSE_OFFSET_MAX, locale) })}</p> : null}
          {grouped ? null : <p className="mt-2 text-sm text-[var(--muted)]">{t.t("ui.games.depthNote", { max: formatNumber(BROWSE_OFFSET_MAX, locale) })}</p>}
        </PageNav>
      ) : null}
    </PageShell>
  );
}
