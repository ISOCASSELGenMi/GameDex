/**
 * 分組檢視的控制項（伺服器元件，沒有 JS 也能用）：
 * - GroupOrderNav：依平台／依廠商的「組排序」（最新發售日／遊戲數／名稱 × 升冪／降冪），與不分組的排序同樣是「箭頭＋標的選單」。全是連結，預設值不寫進網址。
 * - DateRangeNav：依日期分組的起算月——原生年月欄位（type=month，跳出月曆；month-picker.tsx；選擇結果是 `gfrom` 連結）。
 */
import type { ReactElement } from "react";
import type { FilterSpec } from "@sok/api-contract";
import type { Locale, Translator } from "@sok/i18n";
import { GROUP_MONTH_MIN, GROUP_SORTS, type GroupedBy } from "../../../domain/entities";
import { gamesBrowseHref } from "../../links";
import { GroupSortMenu } from "./group-sort-menu";
import { MonthPicker } from "./month-picker";
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
    <GroupSortMenu
      label={t.t("ui.games.groupOrder.sortLabel")}
      dir={view.dir}
      dirLabels={{ asc: t.t("ui.games.groupOrder.dir.asc"), desc: t.t("ui.games.groupOrder.dir.desc") }}
      current={view.sort}
      flipHref={gamesBrowseHref(locale, spec, 1, by, { sort: view.sort, dir: view.dir === "asc" ? "desc" : "asc" })}
      // 目前的標的連到「反向」（再選一次＝切換升降冪），其他標的保留目前方向
      options={GROUP_SORTS.map((s) => ({
        value: s,
        label: t.t(`ui.games.groupOrder.sort.${s}`),
        href: gamesBrowseHref(locale, spec, 1, by, { sort: s, dir: s === view.sort ? (view.dir === "asc" ? "desc" : "asc") : view.dir }),
      }))}
    />
  );
}

export function DateRangeNav({
  locale,
  t,
  spec,
  view,
  currentMonth,
}: {
  locale: Locale;
  t: Translator;
  spec: FilterSpec;
  view: GroupViewParams;
  /** 今天（UTC）所在的月份 `YYYY-MM`。 */
  currentMonth: string;
}): ReactElement {
  return (
    <MonthPicker
      selected={view.from ?? currentMonth}
      minMonth={GROUP_MONTH_MIN}
      maxYear={Number(currentMonth.slice(0, 4)) + 6}
      hrefTemplate={gamesBrowseHref(locale, spec, 1, "date", { from: "__M__" })}
      label={t.t("ui.games.dateNav.jumpLabel")}
    />
  );
}
