/**
 * 月曆的三種呈現（伺服器元件）：
 * - MonthGridView：桌機 CSS Grid 月曆（table role=grid，鍵盤操作由 CalendarInteractive 增強）
 * - AgendaView：手機寬度的議程式清單（依日期分組）
 * - UndatedView：「本月未定日」（月／季／年精度，依精度分組，數量多時預設收合）
 * 桌機／手機用 CSS 斷點切換，被隱藏的那份是 display:none（不在可及樹）。
 */
import type { ReactElement } from "react";
import { formatIsoDate, formatReleaseLabel, formatYearMonth, weekdayNames, type Locale, type Translator } from "@sok/i18n";
import {
  AGENDA_VISIBLE_ITEMS,
  CELL_VISIBLE_ITEMS,
  UNDATED_OPEN_MAX,
  buildMonthGrid,
  foldItems,
  type WeekStart,
  type YearMonth,
} from "../month";
import { FoldedCards } from "./folded-cards";
import { DayItemView, EventEntry, FullCard } from "./items";
import type { CalendarViewModel, CardItem, DayItem, UndatedGroup } from "./view-model";

type HrefOf = (item: CardItem) => string;

/** 折疊區：活動（少量）由伺服器渲染，遊戲卡片交給 FoldedCards（見該檔說明）。 */
function FoldedItems({ items, t }: { items: readonly DayItem[]; t: Translator }): ReactElement {
  const events = items.filter((i) => i.type === "event");
  const cardKeys = items.filter((i) => i.type === "card").map((i) => i.key);
  return (
    <>
      {events.length > 0 ? (
        <ul className="fold-list">
          {events.map((e) => (
            <li key={e.key}>{e.type === "event" ? <EventEntry item={e} t={t} /> : null}</li>
          ))}
        </ul>
      ) : null}
      {cardKeys.length > 0 ? <FoldedCards keys={cardKeys} /> : null}
    </>
  );
}

function dayLabel(iso: string, locale: Locale): string {
  return formatIsoDate(iso, locale, { month: "long", day: "numeric", weekday: "long" });
}

function cellAriaLabel(iso: string, items: readonly DayItem[], locale: Locale, t: Translator): string {
  const date = dayLabel(iso, locale);
  const games = items.filter((i) => i.type === "card").length;
  const events = items.length - games;
  if (items.length === 0) return t.t("a11y.dayCellEmpty", { date });
  if (events === 0) return t.t("a11y.dayCell", { date, count: games });
  return t.t("a11y.dayCellWithEvents", { date, count: games, events });
}

export function MonthGridView({
  ym,
  locale,
  t,
  vm,
  hrefOf,
  weekStart,
  titleId,
}: {
  ym: YearMonth;
  locale: Locale;
  t: Translator;
  vm: CalendarViewModel;
  hrefOf: HrefOf;
  weekStart: WeekStart;
  titleId: string;
}): ReactElement {
  const grid = buildMonthGrid(ym, weekStart);
  const short = weekdayNames(locale, "short", weekStart);
  const long = weekdayNames(locale, "long", weekStart);
  return (
    <table role="grid" aria-labelledby={titleId} className="cal-grid" data-calendar-grid="">
      <thead>
        <tr>
          {short.map((s, i) => (
            <th key={i} scope="col">
              <span aria-hidden="true">{s}</span>
              <span className="sr-only">{long[i]}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.weeks.map((week, w) => (
          <tr key={w}>
            {week.map((iso, d) => {
              if (!iso) return <td key={d} role="gridcell" className="cal-out" />;
              const items = vm.days[iso] ?? [];
              const { visible, folded, hidden } = foldItems(items, CELL_VISIBLE_ITEMS);
              return (
                <td key={d} role="gridcell" data-date={iso} data-day-label={dayLabel(iso, locale)} aria-label={cellAriaLabel(iso, items, locale, t)} className="cal-cell">
                  <span className="day-num" aria-hidden="true">
                    {Number(iso.slice(8, 10))}
                  </span>
                  {visible.length > 0 ? (
                    <ul className="cell-list">
                      {visible.map((item) => (
                        <li key={item.key}>
                          <DayItemView item={item} hrefOf={hrefOf} t={t} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {hidden > 0 ? (
                    <details className="cell-more">
                      <summary data-day-more="">{t.t("ui.calendar.moreItems", { count: hidden })}</summary>
                      <FoldedItems items={folded} t={t} />
                    </details>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AgendaView({
  ym,
  locale,
  t,
  vm,
  hrefOf,
}: {
  ym: YearMonth;
  locale: Locale;
  t: Translator;
  vm: CalendarViewModel;
  hrefOf: HrefOf;
}): ReactElement {
  const days = Object.keys(vm.days).sort();
  const month = formatYearMonth(ym.year, ym.month, locale);
  return (
    <section className="agenda" aria-labelledby="agenda-title">
      <h2 id="agenda-title" className="sr-only">
        {t.t("a11y.calendarAgenda", { month })}
      </h2>
      {days.length === 0 ? <p className="text-[var(--muted)]">{t.t("ui.calendar.noItemsThisMonth")}</p> : null}
      {days.map((iso) => {
        const items = vm.days[iso] ?? [];
        const { visible, folded, hidden } = foldItems(items, AGENDA_VISIBLE_ITEMS);
        const headingId = `ag-${iso}`;
        return (
          <section key={iso} aria-labelledby={headingId} className="agenda-day" data-agenda-day={iso} data-day-label={dayLabel(iso, locale)}>
            <h3 id={headingId} className="agenda-date">
              {dayLabel(iso, locale)}
            </h3>
            <ul className="agenda-list">
              {visible.map((item) => (
                <li key={item.key}>
                  <DayItemView item={item} hrefOf={hrefOf} t={t} />
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <details className="agenda-more">
                <summary>{t.t("ui.calendar.moreItems", { count: hidden })}</summary>
                <FoldedItems items={folded} t={t} />
              </details>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}

function groupTitle(group: UndatedGroup, locale: Locale, t: Translator): string {
  const first = group.items[0]?.card;
  const label = first ? formatReleaseLabel(first.date, group.precision, locale) : "";
  return t.t("ui.calendar.undatedGroupTitle", { group: t.t(`ui.calendar.undatedGroups.${group.precision}`), label });
}

export function UndatedView({
  locale,
  t,
  groups,
  hrefOf,
}: {
  locale: Locale;
  t: Translator;
  groups: readonly UndatedGroup[];
  hrefOf: HrefOf;
}): ReactElement {
  return (
    <section className="undated" aria-labelledby="undated-title">
      <h2 id="undated-title" className="text-lg font-semibold">
        {t.t("ui.calendar.undatedThisMonth")}
      </h2>
      <p className="text-sm text-[var(--muted)]">{t.t("ui.calendar.undatedDescription")}</p>
      {groups.length === 0 ? <p className="mt-2">{t.t("ui.calendar.undatedEmpty")}</p> : null}
      {groups.map((group) => {
        const small = group.items.length <= UNDATED_OPEN_MAX;
        return (
          <details key={group.precision} className="undated-group" open={small}>
            <summary>
              <span className="font-semibold">{groupTitle(group, locale, t)}</span>{" "}
              <span className="text-[var(--muted)]">{t.t("ui.common.parenthetical", { text: t.t("ui.calendar.gamesCount", { count: group.items.length }) })}</span>
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
              <FoldedCards keys={group.items.map((i) => i.key)} className="fold-list fold-columns" />
            )}
          </details>
        );
      })}
    </section>
  );
}
