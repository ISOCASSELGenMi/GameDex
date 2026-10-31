"use client";
/**
 * 依日期分組的起算月：跟時間軸「跳到日期」同一種做法——原生日期欄位，只是改成只選年月（type=month，瀏覽器會跳出月曆）。
 * 選好就整頁導向該月（href 由伺服器依目前篩選條件組好，以 `__M__` 佔位）。
 */
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

export interface MonthPickerProps {
  /** 目前起算月 `YYYY-MM`。 */
  selected: string;
  /** 可選的最早月份 `YYYY-MM` 與最晚年份。 */
  minMonth: string;
  maxYear: number;
  /** 含 `__M__` 的網址樣板。 */
  hrefTemplate: string;
  label: string;
}

export function MonthPicker({ selected, minMonth, maxYear, hrefTemplate, label }: MonthPickerProps): ReactElement {
  const router = useRouter();
  return (
    <label className="mp-root" data-rc-monthpicker="">
      <span className="sr-only">{label}</span>
      <input
        key={selected}
        type="month"
        className="tb-field"
        defaultValue={selected}
        min={minMonth}
        max={`${maxYear}-12`}
        onChange={(e) => {
          const v = e.target.value;
          if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v >= minMonth && v !== selected) router.push(hrefTemplate.replace("__M__", v));
        }}
      />
    </label>
  );
}
