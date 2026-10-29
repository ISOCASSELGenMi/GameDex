/**
 * 月曆的呈現（伺服器元件）：
 * - MonthGridView：月份網格。一個日期一格、一格只顯示一款遊戲（DayCell 客戶端元件負責格內切換）；
 *   窄螢幕（< 640px）用同一份標記，CSS 改成「有內容的日期」逐列清單。
 * - UndatedView：「本月未定日」（月／季／年精度，依精度分組，數量多時預設收合）。
 */
import type { ReactElement } from "react";
import type { FilterSpec } from "@sok/api-contract";
import { formatIsoDate, formatReleaseLabel, weekdayNames, type Locale, type Translator } from "@sok/i18n";
import { filterSpecForPage } from "../filters/filter-labels";
import { gamesBrowseHref } from "../links";
import { UNDATED_OPEN_MAX, buildMonthGrid, weekdayOf, type WeekStart, type YearMonth } from "../month";
import { DayCell } from "./day-cell";
import { FoldedCards } from "./folded-cards";
import { EventEntry, FullCard } from "./items";
import type { CalendarViewModel, CardItem, UndatedGroup } from "./view-model";

type HrefOf = (item: CardItem) => string;

function dayLabel(iso: string, locale: Locale): string {
  return formatIsoDate(iso, locale, { month: "long", day: "numeric", weekday: "long" });
}

function cellAriaLabel(iso: string, games: number, events: number, locale: Locale, t: Translator): string {
  const date = dayLabel(iso, locale);
  if (games === 0 && events === 0) return t.t("a11y.dayCellEmpty", { date });
  if (events === 0) return t.t("a11y.dayCell", { date, count: games });
  return t.t("a11y.dayCellWithEvents", { date, count: games, events });
}

export function MonthGridView({
  ym,
  locale,
  t,
  vm,
  weekStart,
  titleId,
}: {
  ym: YearMonth;
  locale: Locale;
  t: Translator;
  vm: CalendarViewModel;
  weekStart: WeekStart;
  titleId: string;
}): ReactElement {
  const grid = buildMonthGrid(ym, weekStart);
  const short = weekdayNames(locale, "short", weekStart);
  return (
    <div className="cal-wrap">
      <div className="cal-weekdays" aria-hidden="true">
        {short.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      <ol className="cal-grid" aria-labelledby={titleId} data-calendar-grid="">
        {Array.from({ length: grid.leading }, (_, i) => (
          <li key={`pad-${i}`} className="cal-pad" aria-hidden="true" />
        ))}
        {grid.weeks.flat().map((iso) => {
          if (!iso) return null;
          const day = vm.days[iso];
          const total = day?.total ?? 0;
          const events = day?.events ?? [];
          const empty = total === 0 && events.length === 0;
          return (
            <li key={iso} className="cal-day" data-date={iso} data-empty={empty ? "true" : undefined}>
              <DayCell
                date={iso}
                dayNum={Number(iso.slice(8, 10))}
                weekday={short[(weekdayOf(iso) - weekStart + 7) % 7] ?? ""}
                ariaLabel={cellAriaLabel(iso, total, events.length, locale, t)}
                total={total}
                first={day?.first ?? null}
              >
                {events.length > 0 ? (
                  <ul className="cal-events">
                    {events.map((e) => (
                      <li key={e.key}>
                        <EventEntry item={e} t={t} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </DayCell>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function groupTitle(group: UndatedGroup, locale: Locale, t: Translator): string {
  const label = group.firstDate ? formatReleaseLabel(group.firstDate, group.precision, locale) : "";
  return t.t("ui.calendar.undatedGroupTitle", { group: t.t(`ui.calendar.undatedGroups.${group.precision}`), label });
}

export function UndatedView({
  locale,
  t,
  groups,
  hrefOf,
  spec = {},
}: {
  locale: Locale;
  t: Translator;
  groups: readonly UndatedGroup[];
  hrefOf: HrefOf;
  /** 月曆目前的篩選；「查看全部」連結帶同一組條件（瀏覽頁不適用的參數略過）。 */
  spec?: FilterSpec;
}): ReactElement {
  return (
    <section className="undated" aria-labelledby="undated-title">
      <h2 id="undated-title" className="text-lg font-semibold">
        {t.t("ui.calendar.undatedThisMonth")}
      </h2>
      <p className="text-sm text-[var(--muted)]">{t.t("ui.calendar.undatedDescription")}</p>
      {groups.length === 0 ? <p className="mt-2">{t.t("ui.calendar.undatedEmpty")}</p> : null}
      {groups.map((group) => {
        const small = group.count <= UNDATED_OPEN_MAX;
        return (
          <details key={group.precision} className="undated-group" open={small}>
            <summary>
              <span className="font-semibold">{groupTitle(group, locale, t)}</span>{" "}
              <span className="text-[var(--muted)]">{t.t("ui.common.parenthetical", { text: t.t("ui.calendar.gamesCount", { count: group.count }) })}</span>
            </summary>
            {small ? (
              <ul className="undated-tiles">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <FullCard item={item} href={hrefOf(item)} t={t} />
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <FoldedCards rows={group.rows} className="fold-list fold-columns" />
                {group.more && group.year !== null ? (
                  <p className="undated-more">
                    <a className="btn-secondary" href={gamesBrowseHref(locale, { ...filterSpecForPage(spec, "browse"), year: group.year }, 1, "date")}>
                      {t.t("ui.calendar.undatedViewAll", { count: group.count })}
                    </a>
                  </p>
                ) : null}
              </>
            )}
          </details>
        );
      })}
    </section>
  );
}
