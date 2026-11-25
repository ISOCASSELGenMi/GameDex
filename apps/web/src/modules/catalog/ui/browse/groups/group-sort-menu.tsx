"use client";
/**
 * 分組檢視（依平台／依廠商）的組排序：與不分組的排序同一個樣子——同一個框裡「左側方向三角（連結，點了切換升降冪）＋標的」，點標的開選單；
 * 再選一次目前的標的＝切換升降冪。全是連結（href 由伺服器組好、預設值不寫進網址）；選單展開需要 JS。
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { DirTriangle } from "../sort-menu";

export interface GroupSortMenuProps {
  /** 無障礙名稱（「組排序」）。 */
  label: string;
  /** 目前方向。 */
  dir: "asc" | "desc";
  dirLabels: { asc: string; desc: string };
  /** 方向三角的連結：同標的、反向。 */
  flipHref: string;
  /** 排序標的：顯示文字與連結（目前標的的連結＝切換方向）。 */
  current: string;
  options: readonly { value: string; label: string; href: string }[];
}

export function GroupSortMenu({ label, dir, dirLabels, flipHref, current, options }: GroupSortMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
  const shown = options.find((o) => o.value === current)?.label ?? current;
  return (
    <div ref={rootRef} className="sort-menu" role="group" aria-label={label} data-rc-order="">
      <a className="sort-dir" href={flipHref} aria-label={dirLabels[dir]} title={dirLabels[dir]} data-rc-gdir-current={dir}>
        <DirTriangle desc={dir === "desc"} />
      </a>
      <button type="button" className="sort-current" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {shown}
        <span className="sr-only">{dirLabels[dir]}</span>
      </button>
      {open ? (
        <ul className="sort-list" role="menu" aria-label={label}>
          {options.map((o) => (
            <li key={o.value} role="none">
              <a className="sort-option" role="menuitem" href={o.href} aria-current={o.value === current ? "true" : undefined} data-rc-gsort={o.value}>
                {o.label}
                {o.value === current ? <DirTriangle desc={dir === "desc"} /> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
