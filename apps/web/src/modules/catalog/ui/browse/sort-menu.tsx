"use client";
/**
 * 排序控制（參考 AniList）：同一個框裡「方向三角（▲升冪／▼降冪，在左側、可直接點擊切換）＋排序標的」，點標的開選單；
 * 選另一個標的＝換標的（回到該標的的預設方向）；再選一次目前的標的＝切換升降冪。
 * 值放在看不見的 `sort` 文字欄位（即時篩選表單聽 change 事件）；方向用 `_asc`／`_desc` 後綴的排序值表示（見 FILTER_SORTS）。
 * 沒有 JS 時只顯示目前排序（可用網址參數改排序）。
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

type Base = "popularity" | "release_date" | "name";
const BASES: readonly Base[] = ["popularity", "release_date", "name"];
/** 各基本排序的預設方向是否為降冪（popularity 高到低；上市日期、名稱預設由小到大）。 */
const DEFAULT_DESC: Record<Base, boolean> = { popularity: true, release_date: false, name: false };
const FLIP_SUFFIX: Record<Base, string> = { popularity: "popularity_asc", release_date: "release_date_desc", name: "name_desc" };

function parse(value: string): { base: Base; desc: boolean } {
  const flipped = value.endsWith("_asc") || value.endsWith("_desc");
  const base = (flipped ? value.replace(/_(asc|desc)$/, "") : value) as Base;
  const b: Base = BASES.includes(base) ? base : "popularity";
  return { base: b, desc: flipped ? !DEFAULT_DESC[b] : DEFAULT_DESC[b] };
}
function compose(base: Base, desc: boolean): string {
  return desc === DEFAULT_DESC[base] ? base : FLIP_SUFFIX[base];
}

/** 方向三角：▲ 升冪、▼ 降冪（實心）。 */
export function DirTriangle({ desc }: { desc: boolean }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" className="sort-tri">
      {desc ? <path d="M8 13 1.5 3h13z" /> : <path d="M8 3 14.5 13h-13z" />}
    </svg>
  );
}

export interface SortMenuLabels {
  sort: string;
  asc: string;
  desc: string;
  options: Record<Base, string>;
}

export function SortMenu({ value, labels, describedBy }: { value: string; labels: SortMenuLabels; describedBy?: string }): ReactElement {
  const [current, setCurrent] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const { base, desc } = parse(current);

  // 值改變後通知即時篩選表單（略過第一次）
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    hiddenRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [current]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="sort-menu" role="group" aria-label={labels.sort}>
      {/* type=text＋hidden 屬性（不是 type=hidden）：即時篩選表單只讀非 hidden 型的欄位，並在 change 時立即套用 */}
      <input ref={hiddenRef} type="text" hidden readOnly name="sort" value={current} />
      <button type="button" className="sort-dir" aria-label={desc ? labels.desc : labels.asc} title={desc ? labels.desc : labels.asc} onClick={() => setCurrent(compose(base, !desc))}>
        <DirTriangle desc={desc} />
      </button>
      <button type="button" className="sort-current" aria-haspopup="listbox" aria-expanded={open} aria-describedby={describedBy} onClick={() => setOpen((o) => !o)}>
        {labels.options[base]}
        <span className="sr-only">{desc ? labels.desc : labels.asc}</span>
      </button>
      {open ? (
        <ul className="sort-list" role="listbox" aria-label={labels.sort}>
          {BASES.map((b) => (
            <li key={b} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={b === base}
                className="sort-option"
                onClick={() => {
                  // 再選一次目前的標的＝切換升降冪；選別的標的＝該標的的預設方向
                  setCurrent(b === base ? compose(b, !desc) : b);
                  setOpen(false);
                }}
              >
                {labels.options[b]}
                {b === base ? <DirTriangle desc={desc} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
