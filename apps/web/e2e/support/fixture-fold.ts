/**
 * 月曆「本月未定日」只送前 24 款（方案 A）的 e2e fixture 固定值（seed-fold.ts 寫入、測試斷言共用；不 import 任何 DB 程式）。
 * 日期固定在 2038-12：年精度 30 款（> 24，要摺起來並只送前 24）、季精度正好 24 款（不超過，不出現連結）。
 * 遊戲名稱都帶 "FoldF"。熱度由高到低 = 編號由小到大（Y01 最高）。
 */
export const FIXTURE_FOLD = {
  month: "2038-12",
  year: 2038,
  yearGroup: { count: 30, prefix: "FoldF Year", slugPrefix: "e2e-foldf-year" },
  quarterGroup: { count: 24, prefix: "FoldF Quarter", slugPrefix: "e2e-foldf-quarter" },
  /** 摺起來的組送出的款數上限（= UNDATED_OPEN_MAX）。 */
  shown: 24,
  platform: "e2e-pc",
} as const;

export const foldName = (prefix: string, i: number): string => `${prefix} ${String(i).padStart(2, "0")}`;
