/**
 * 分組檢視的控制項（伺服器元件，沒有 JS 也能用）：
 * - GroupOrderNav：依平台／依廠商的「組排序」（最新發售日／遊戲數／名稱 × 升冪／降冪）。全是連結，預設值不寫進網址。
 * - DateRangeNav：依日期分組的「往前看較早的月份」連結（只在第 1 頁）與「跳到年／月」GET 表單（年、月兩個下拉＋前往；
 *   沒有 JS 時 `gyear`＋`gmonth` 由伺服器組成起算月，頁面自己產生的連結一律用 `gfrom`）。
 */
import Form from "next/form";
import type { ReactElement } from "react";
import type { FilterSpec } from "@sok/api-contract";
import type { Locale, Translator } from "@sok/i18n";
import { GAME_GROUPS_PER_PAGE, GROUP_DIRS, GROUP_MONTH_MIN, GROUP_SORTS, shiftGroupMonth, type GroupedBy } from "../../../domain/entities";
import { gamesBrowseHref } from "../../links";
import { hiddenFilterFields } from "../view-model";
import type { GroupViewParams } from "./params";

export function GroupOrderNav({
  locale,
  t,
  spec,
  by,
  view,
}: {
  locale: Locale;
  t: Translator;
  spec: FilterSpec;
  by: Exclude<GroupedBy, "date">;
  view: GroupViewParams;
}): ReactElement {
  return (
    <div className="rc-order" data-rc-order="">
      <nav className="rc-order-group" aria-label={t.t("ui.games.groupOrder.sortLabel")}>
        <span className="rc-order-label">{t.t("ui.games.groupOrder.sortLabel")}</span>
        {GROUP_SORTS.map((s) => (
          <a
            key={s}
            className="rc-order-item"
            href={gamesBrowseHref(locale, spec, 1, by, { sort: s, dir: view.dir })}
            aria-current={view.sort === s ? "true" : undefined}
            data-rc-gsort={s}
          >
            {t.t(`ui.games.groupOrder.sort.${s}`)}
          </a>
        ))}
      </nav>
      <nav className="rc-order-group" aria-label={t.t("ui.games.groupOrder.dirLabel")}>
        <span className="rc-order-label">{t.t("ui.games.groupOrder.dirLabel")}</span>
        {GROUP_DIRS.map((d) => (
          <a
            key={d}
            className="rc-order-item"
            href={gamesBrowseHref(locale, spec, 1, by, { sort: view.sort, dir: d })}
            aria-current={view.dir === d ? "true" : undefined}
            data-rc-gdir={d}
          >
            {t.t(`ui.games.groupOrder.dir.${d}`)}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** 年份下拉的範圍：GROUP_MONTH_MIN 的年份到今年＋6（已選的年份不在範圍內時補進去）。 */
export function groupYearOptions(selectedYear: number, currentYear: number): number[] {
  const first = Number(GROUP_MONTH_MIN.slice(0, 4));
  const last = Math.max(currentYear + 6, selectedYear);
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
}

function monthName(locale: Locale, month: number): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 1)));
}

export function DateRangeNav({
  locale,
  t,
  spec,
  view,
  currentMonth,
  page,
  action,
}: {
  locale: Locale;
  t: Translator;
  spec: FilterSpec;
  view: GroupViewParams;
  /** 今天（UTC）所在的月份 `YYYY-MM`。 */
  currentMonth: string;
  page: number;
  /** 表單送出的路徑（`/{locale}/games`）。 */
  action: string;
}): ReactElement {
  const effective = view.from ?? currentMonth;
  const earlier = shiftGroupMonth(effective, -GAME_GROUPS_PER_PAGE);
  const canGoEarlier = page === 1 && effective > GROUP_MONTH_MIN;
  const selectedYear = Number(effective.slice(0, 4));
  const selectedMonth = Number(effective.slice(5, 7));
  const hidden = [...hiddenFilterFields(spec, []), { name: "by", value: "date" }];
  return (
    <div className="rc-datenav" data-rc-datenav="">
      {canGoEarlier ? (
        <a className="btn-secondary" href={gamesBrowseHref(locale, spec, 1, "date", { from: earlier })} data-rc-earlier={earlier}>
          {t.t("ui.games.dateNav.earlier", { month: earlier })}
        </a>
      ) : null}
      <Form action={action} prefetch={false} className="rc-datejump" aria-label={t.t("ui.games.dateNav.jumpLabel")} data-rc-jump="">
        {hidden.map((h) => (
          <input key={`${h.name}:${h.value}`} type="hidden" name={h.name} value={h.value} />
        ))}
        <label className="flex flex-col gap-1">
          <span className="font-bold">{t.t("ui.games.dateNav.year")}</span>
          <select name="gyear" defaultValue={String(selectedYear)} className="rc-datejump-select">
            {groupYearOptions(selectedYear, Number(currentMonth.slice(0, 4))).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold">{t.t("ui.games.dateNav.month")}</span>
          <select name="gmonth" defaultValue={String(selectedMonth)} className="rc-datejump-select">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(locale, m)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          {t.t("ui.games.dateNav.go")}
        </button>
      </Form>
      <p className="rc-datenav-current text-sm text-[var(--muted)]">
        {view.from ? t.t("ui.games.dateNav.fromCurrent", { month: view.from }) : t.t("ui.games.dateNav.defaultCurrent", { month: currentMonth })}
      </p>
    </div>
  );
}
