"use client";
/** 月曆格（DayCell）向側邊預覽卡（CalendarInteractive）要求開啟的介面。 */
import { createContext, useContext } from "react";
import type { DayCellLabels, PreviewCardData } from "./types";

export interface CalendarSheetApi {
  /** 開啟預覽卡；trigger＝關閉後把焦點還給的元素。 */
  openCard(card: PreviewCardData, trigger: HTMLElement | null): void;
}

export const CalendarSheetContext = createContext<CalendarSheetApi | null>(null);

/** 月曆格共用的設定（整頁只送一份，不在每一格的 props 重複：整月 31 格會讓 HTML 多出幾 KB）。 */
export interface CalendarCellConfig {
  /** day API 網址（含 locale 與篩選 query，不含 date）。 */
  apiBase: string;
  labels: DayCellLabels;
}

export const CalendarCellConfigContext = createContext<CalendarCellConfig | null>(null);

export function useCalendarSheet(): CalendarSheetApi | null {
  return useContext(CalendarSheetContext);
}
