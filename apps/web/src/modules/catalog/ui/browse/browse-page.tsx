/**
 * 遊戲瀏覽／搜尋頁 `/[locale]/games`（06 §瀏覽與搜尋）。伺服器元件。
 * - 搜尋框（role="search"）＋年份＋排序（只開放熱度／上市日期／名稱；名稱排序依原文，頁面標示）
 * - 共用篩選面板（遊戲層級維度）；已套用條件的 chip；空結果列出條件可逐一移除
 * - 分頁：上一頁／下一頁（不算總數）；offset ≤ BROWSE_OFFSET_MAX，頁面說明此限制
 * - 結果筆數：role="status" 的 live region
 * - 分組檢視 `?by=date|platform|publisher`（預設 none＝上面的清單）：同一批遊戲（受搜尋與篩選限制）分成幾組，一頁 GAME_GROUPS_PER_PAGE 組（`page` 翻組），
 *   每組先送 GAME_GROUP_INITIAL 張卡，其餘「顯示更多」按需從 /api/v1/games/group 載入
 *   組內固定發售日由新到舊（分組檢視隱藏排序欄位）；依平台／廠商有組排序（gsort、gdir），依日期有起算月（gfrom、往前看、跳到年月）
 */
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactElement } from "react";
import { FILTER_QUERY_MAX_LENGTH, filterSpecToQueryString, parseFilterSpec, type FilterSearchInput } from "@sok/api-contract";
import { formatNumber, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import { BROWSE_OFFSET_MAX, BROWSE_PAGE_SIZE, GAME_GROUP_BYS, type BrowseGameCard, type GameGroupBy } from "../../domain/entities";
import { browseGames } from "../../use-cases/read";
import { loadFilterOptions } from "../calendar/filter-options";
import { collectFilterNotices, filterSpecToReadQuery, withoutIgnored } from "../filter-mapping";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "../filters/filter-labels";
import { lastPageWithContent } from "../filters/live-filter";
import { LiveFilterForm } from "../filters/live-filter-form";
import { AppliedFilterChips, EmptyFilterResult, FilterNotices, FilterPanel } from "../filters/filter-panel";
import { HeatBadge, HeatSprite, heatBadgeLabel } from "../heat-badge";
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
  browseOffset,
  browsePagination,
  browseRange,
  hiddenFilterFields,
  parseBrowsePage,
  yearFieldValues,
} from "./view-model";
import { GroupCardList, GroupSwitch, GroupsProvider } from "./groups/groups-client";
import { SortMenu } from "./sort-menu";
import { ViewSwitch } from "./view-switch";
import { groupApiBase, loadGameGroups, type GroupView } from "./groups/groups-server";
import { DateRangeNav, GroupOrderNav } from "./groups/group-controls";
import {
  groupPagination,
  groupQueryParts,
  groupRange,
  isGrouped,
  parseGameGroupBy,
  parseGroupDir,
  parseGroupFrom,
  parseGroupPage,
  parseGroupSort,
  type GroupViewParams,
} from "./groups/params";

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

const HEAT_SPRITE_ID = "browse-heat-flame";

function GameCard({ game, locale, t }: { game: BrowseGameCard; locale: Locale; t: Translator }): ReactElement {
  const dateText = formatReleaseLabel(game.firstReleaseDate, game.firstReleasePrecision ?? "tbd", locale);
  const shown = game.platforms.slice(0, 4).map((p) => p.abbreviation ?? p.name);
  const platformText = shown.join(t.t("ui.common.listSeparator")) + (game.platforms.length > 4 ? ` +${game.platforms.length - 4}` : "");
  // 卡片 markup 刻意精簡（class 名稱、純 <img>、熱度圖示用 sprite）：一頁 24 張卡，伺服器 HTML 與 RSC payload 各會出現一次（06 §瀏覽與搜尋 的頁面大小預算）
  return (
    <li className="bc-item" data-browse-item={game.slug}>
      <a className="summary-card" href={gameHref(locale, game.slug)}>
        {game.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- 封面本來就是 unoptimized 外部圖；純 <img> 少掉 next/image 的屬性與客戶端元件參照
          <img className="summary-thumb" src={game.cover.small} data-m={game.cover.medium !== game.cover.small ? game.cover.medium : undefined} alt="" width={90} height={128} loading="lazy" decoding="async" />
        ) : (
          <span className="summary-thumb card-thumb-empty" aria-hidden="true" />
        )}
        <span className="bc-info">
          <span className="bc-name" lang={gameNameLang(game.name, game.name === game.originalName, locale)}>
            {game.name}
          </span>
          {/* 第二行一律是原文：沒有翻譯（主標題＝原文）時留空但保留固定高度，同一列的卡片才會等高 */}
          {game.originalName !== game.name ? (
            <span className="bc-meta bc-orig [overflow-wrap:anywhere]" lang="en">
              {game.originalName}
            </span>
          ) : (
            <span className="bc-meta bc-orig" aria-hidden="true" />
          )}
          <span className="bc-meta">{t.t("ui.common.labelValue", { label: t.t("ui.games.firstRelease"), value: dateText })}</span>
          {game.platforms.length > 0 ? <span className="bc-meta">{platformText}</span> : null}
          <span className="bc-tags">
            {game.gameType !== "main_game" ? <span className="chip">{t.t(`enums.gameType.${game.gameType}`)}</span> : null}
            {game.gameStatus === "rumored" ? <span className="chip">{t.t("enums.gameStatus.rumored")}</span> : null}
            <HeatBadge level={game.heatLevel} label={heatBadgeLabel(t, game.heatLevel)} spriteId={HEAT_SPRITE_ID} />
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
  // 分組檢視的檢視參數：依平台／廠商的組排序（gsort、gdir）、依日期的起算月（gfrom；沒有 JS 的跳月表單是 gyear＋gmonth）。非 grouped 時用不到
  const view: GroupViewParams = {
    sort: parseGroupSort(first(searchParams.gsort)),
    dir: parseGroupDir(first(searchParams.gdir)),
    from: parseGroupFrom(first(searchParams.gfrom), first(searchParams.gyear), first(searchParams.gmonth)),
  };
  const currentMonth = new Date().toISOString().slice(0, 7);
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
      grouped ? loadGameGroups({ locale, spec: pageSpec, by, page: pageNo, view }, t) : Promise.resolve(null),
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
  // 即時篩選保留頁碼：篩選後該頁已超出範圍（空頁）就退到最後一頁（整頁導向正規網址）
  if (pageNo > 1 && (grouped ? groupsResult!.groups.length === 0 : result!.games.length === 0)) {
    const hasContent = async (p: number): Promise<boolean> => {
      if (grouped) return (await loadGameGroups({ locale, spec: pageSpec, by, page: p, view }, t)).groups.length > 0;
      return (await browseGames({ filter: query.filter, yearFrom: query.yearFrom, yearTo: query.yearTo, q: query.q, sort: query.sort, offset: browseOffset(p), limit: BROWSE_PAGE_SIZE, locale })).games.length > 0;
    };
    redirect(gamesBrowseHref(locale, spec, await lastPageWithContent(pageNo - 1, hasContent), by, view));
  }
  const basePath = localeHref(locale, "/games");
  const extraQuery = groupQueryParts(by, view).join("&");
  const chips = appliedChips(spec, basePath, makeFilterLabeler(t, options), extraQuery);
  const clearHref = localeHref(locale, "/games", extraQuery);
  const games = result?.games ?? [];
  const groups = groupsResult?.groups ?? [];
  const sort = spec.sort ?? "popularity";
  const years = yearFieldValues(spec);
  const range = result ? browseRange(result.offset, result.games.length) : null;
  const pager = result ? browsePagination(pageNo, result.hasMore) : groupPagination(pageNo, groupsResult?.hasMoreGroups ?? false);
  const groupsText = groupRange(pageNo, groups.length);
  const shellQuery = [filterSpecToQueryString(spec), ...groupQueryParts(by, view, pageNo)].filter(Boolean).join("&");
  const panelHidden: Record<string, string | undefined> = {
    q: spec.q,
    sort: spec.sort,
    yearFrom: years.from || undefined,
    yearTo: years.to || undefined,
  };
  const hidden = hiddenFilterFields(spec, ["q", "sort", "year", "yearFrom", "yearTo"]);
  if (grouped) {
    if (spec.sort) hidden.push({ name: "sort", value: spec.sort });
    // 搜尋與篩選表單送出後要留在同一個分組檢視與組排序／起算月（預設值不帶）
    for (const part of groupQueryParts(by, view)) {
      const [name, value] = part.split("=") as [string, string];
      hidden.push({ name, value });
      panelHidden[name] = value;
    }
  }
  const groupLabels = Object.fromEntries(GAME_GROUP_BYS.map((v) => [v, t.t(`ui.games.by.${v}`)])) as Record<GameGroupBy, string>;

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/games" query={shellQuery}>
      <h1 className="text-2xl font-bold">{t.t("ui.games.title")}</h1>
      <p className="mt-1 mb-3 text-sm text-[var(--muted)]">{t.t("ui.games.intro")}</p>

      {/* 精簡工具列（參考 AniList）：搜尋＋年份＋排序（同一個表單）、篩選圖示鈕（面板在下方浮出）、卡片大小切換 */}
      <div className="tb-row">
        <LiveFilterForm
          action={basePath}
          role="search"
          ariaLabel={t.t("ui.games.searchLabel")}
          className="filter-form browse-bar"
          bare
          submitOnlyNames={["q"]}
          updatingText={t.t("filters.live.updating")}
          updatedText={t.t("filters.live.updated")}
          hiddenFields={hidden.map((h) => (
            <input key={`${h.name}:${h.value}`} type="hidden" name={h.name} value={h.value} />
          ))}
        >
          <div className="tb">
            <div className="tb-search">
              <label htmlFor="browse-search" className="sr-only">
                {t.t("ui.games.searchLabel")}
              </label>
              <SearchCombobox
                locale={locale}
                id="browse-search"
                defaultValue={spec.q ?? ""}
                maxLength={FILTER_QUERY_MAX_LENGTH}
                placeholder={t.t("ui.games.searchPlaceholder")}
                labels={searchBoxLabels(t)}
                inputClassName="tb-field w-full"
              />
            </div>
            <fieldset aria-describedby="browse-year-hint" className="tb-years">
              <legend className="sr-only">{t.t("ui.games.yearLegend")}</legend>
              <p id="browse-year-hint" className="sr-only">
                {t.t("ui.games.yearHint")}
              </p>
              <label className="tb-year">
                <span className="sr-only">{t.t("filters.dimensions.yearFrom")}</span>
                <input type="number" inputMode="numeric" name="yearFrom" min={1900} max={2200} defaultValue={years.from} placeholder={t.t("filters.dimensions.yearFrom")} className="tb-field w-24" />
              </label>
              <span aria-hidden="true">–</span>
              <label className="tb-year">
                <span className="sr-only">{t.t("filters.dimensions.yearTo")}</span>
                <input type="number" inputMode="numeric" name="yearTo" min={1900} max={2200} defaultValue={years.to} placeholder={t.t("filters.dimensions.yearTo")} className="tb-field w-24" />
              </label>
            </fieldset>
            {/* 分組檢視組內固定「發售日由新到舊」，瀏覽的排序不適用：隱藏排序欄位（值仍用隱藏欄位帶著，切回不分組時還在） */}
            <button type="submit" className="btn-primary tb-submit">
              {t.t("ui.games.searchButton")}
            </button>
            {grouped ? null : (
              <SortMenu
                key={sort} // 網址的排序變了（即時篩選、上一頁）就重建，狀態永遠與網址一致
                value={sort}
                describedBy="browse-sort-note"
                labels={{
                  sort: t.t("ui.games.sortLabel"),
                  asc: t.t("ui.games.sortDir.asc"),
                  desc: t.t("ui.games.sortDir.desc"),
                  options: {
                    popularity: t.t("filters.sortValues.popularity"),
                    release_date: t.t("filters.sortValues.release_date"),
                    name: t.t("filters.sortValues.name"),
                  },
                }}
              />
            )}
          </div>
          {grouped ? null : (
            <p id="browse-sort-note" className="tb-note">
              {t.t(`ui.games.sortNote.${sort.replace(/_(asc|desc)$/, "")}`)}
            </p>
          )}
        </LiveFilterForm>
        {by === "platform" || by === "publisher" ? <GroupOrderNav locale={locale} t={t} spec={spec} by={by} view={view} /> : null}
        {by === "date" ? <DateRangeNav locale={locale} t={t} spec={spec} view={view} currentMonth={currentMonth} /> : null}
        <FilterPanel locale={locale} t={t} options={options} spec={spec} action={basePath} fields={BROWSE_FILTER_FIELDS} hidden={panelHidden} clearHref={clearHref} />
        {grouped ? null : (
          <ViewSwitch labels={{ group: t.t("ui.games.view.label"), cover: t.t("ui.games.view.cover"), card: t.t("ui.games.view.card"), list: t.t("ui.games.view.list") }} />
        )}
      </div>

      <div className="cal-tools">
        <FilterNotices notices={notices} t={t} />
        <AppliedFilterChips chips={chips} t={t} clearHref={clearHref} />
        {slots?.filterLinks}
        <div className="rc-nav">
          <GroupSwitch
            legend={t.t("ui.games.groupBy")}
            name="by"
            current={by}
            items={GAME_GROUP_BYS.map((value) => ({ value, label: groupLabels[value], href: gamesBrowseHref(locale, spec, 1, value, view) }))}
          />
          <noscript>
            <ul className="rc-noscript">
              {GAME_GROUP_BYS.map((value) => (
                <li key={value}>
                  <a className="link" href={gamesBrowseHref(locale, spec, 1, value, view)} aria-current={value === by ? "true" : undefined}>
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
              <a className="link" href={gamesBrowseHref(locale, spec, 1, by, view)}>
                {t.t("ui.games.backToFirst")}
              </a>
            </p>
          ) : null}
        </>
      ) : grouped ? (
        <GroupsProvider
          key={`${by}|${pageNo}|${groupQueryParts(by, view).join("&")}|${filterSpecToQueryString(spec)}`}
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
        <>
          <HeatSprite id={HEAT_SPRITE_ID} />
          <ul className="bc-list" aria-label={t.t("ui.games.listLabel")}>
            {games.map((g) => (
              <GameCard key={g.gameId} game={g} locale={locale} t={t} />
            ))}
          </ul>
        </>
      )}

      {pageNo > 1 || pager.next || pager.limitReached ? (
        <PageNav
          label={t.t("ui.games.pagination")}
          prevHref={pager.prev ? gamesBrowseHref(locale, spec, pager.prev, by, view) : null}
          nextHref={pager.next ? gamesBrowseHref(locale, spec, pager.next, by, view) : null}
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
