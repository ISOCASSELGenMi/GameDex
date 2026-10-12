/**
 * IGDB 日期正規化（04 §日期正規化）。
 * `date` 一律當 UTC 日期；依 `date_format` 與 UTC 年／月自己算期間，不照抄 IGDB 的 `date`。
 */
import type { IsoDate, ReleaseDateSpan } from "../../domain/entities";

const TBD: ReleaseDateSpan = { releaseDate: null, periodStart: null, precision: "tbd" };

function iso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 該月最後一天（閏年由 Date.UTC 處理）。month 為 1~12。 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * @param date IGDB unix timestamp（秒）；null／undefined → tbd
 * @param dateFormat 0 YYYYMMDD、1 YYYYMM、2 YYYY、3~6 YYYYQ1~Q4、7 TBD；其他 → tbd 並呼叫 onUnknown
 */
export function normalizeIgdbDate(
  date: number | null | undefined,
  dateFormat: number | null | undefined,
  onUnknown?: (dateFormat: number | null | undefined) => void,
): ReleaseDateSpan {
  if (dateFormat === 7) return TBD;
  const known = dateFormat != null && Number.isInteger(dateFormat) && dateFormat >= 0 && dateFormat <= 6;
  if (!known) {
    onUnknown?.(dateFormat);
    return TBD;
  }
  if (date == null || !Number.isFinite(date)) return TBD;

  const d = new Date(date * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;

  switch (dateFormat) {
    case 0: {
      const day = iso(y, m, d.getUTCDate());
      return { releaseDate: day, periodStart: day, precision: "day" };
    }
    case 1: {
      const first = iso(y, m, 1);
      return { releaseDate: first, periodStart: first, precision: "month" };
    }
    case 2:
      return { releaseDate: iso(y, 12, 31), periodStart: iso(y, 1, 1), precision: "year" };
    default: {
      // 3~6 → Q1~Q4：季別看 date_format，年份看 date
      const q = dateFormat - 2;
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      return {
        releaseDate: iso(y, endMonth, lastDayOfMonth(y, endMonth)),
        periodStart: iso(y, startMonth, 1),
        precision: "quarter",
      };
    }
  }
}
