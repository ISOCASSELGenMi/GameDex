/**
 * 遊戲瀏覽頁「依日期分組」的組 key（`games.release_group` 預先計算欄位的唯一規則；零外部依賴）：
 * 日／月精度 `YYYY-MM`、季精度 `YYYY-Qn`、年精度 `YYYY`、日期未定（沒有日期或精度 tbd）`tbd`。
 * 寫入路徑（syncIgdbGame、backfill_game_groups）呼叫這裡；讀取的 SQL 只讀欄位，不重算。
 */
import type { DatePrecision } from "./entities";

export const TBD_RELEASE_GROUP = "tbd";

/** @param date `YYYY-MM-DD`（games.first_release_date）；null＝未定。 */
export function releaseGroupKey(date: string | null | undefined, precision: DatePrecision | null | undefined): string {
  if (!date || !precision || precision === "tbd") return TBD_RELEASE_GROUP;
  const year = date.slice(0, 4);
  if (precision === "year") return year;
  const month = Number(date.slice(5, 7));
  if (precision === "quarter") return `${year}-Q${Math.ceil(month / 3)}`;
  return `${year}-${date.slice(5, 7)}`;
}
