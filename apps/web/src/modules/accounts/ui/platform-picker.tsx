"use client";
/**
 * 平台多選（依種類分組的 <details>＋核取方塊，最多 max 個，滿了其餘停用）。私人行事曆的平台篩選與帳號設定的「常用平台」共用同一份。
 * 一開始就有勾選的群組預設展開；之後不受勾選動作影響（避免取消最後一個勾選時整組收起）。種類名稱字串：`feedcal.kind.*`。
 */
import { useState, type ReactElement } from "react";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export interface PlatformGroup {
  kind: string;
  platforms: { id: number; name: string }[];
}

export interface PlatformPickerProps {
  strings: AccountStrings;
  groups: PlatformGroup[];
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  max: number;
  legend: string;
  hint: string;
  /** 達到上限時顯示的說明。 */
  fullText: string;
  error?: string | null;
}

export function PlatformPicker({ strings, groups, selected, onChange, max, legend, hint, fullText, error }: PlatformPickerProps): ReactElement | null {
  const [openKinds] = useState(() => new Set(groups.filter((g) => g.platforms.some((p) => selected.has(p.id))).map((g) => g.kind)));
  if (groups.length === 0) return null;
  const full = selected.size >= max;
  function toggle(id: number, on: boolean): void {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="font-semibold">{legend}</legend>
      <p className="text-sm text-[var(--muted)]">{hint}</p>
      {full ? <p className="text-sm">{fullText}</p> : null}
      {groups.map((g) => {
        const count = g.platforms.filter((p) => selected.has(p.id)).length;
        return (
          <details key={g.kind} className="rounded-md border border-[var(--border)] px-3" open={openKinds.has(g.kind)}>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">
              {str(strings, `feedcal.kind.${g.kind}`)}
              {count > 0 ? ` (${count})` : ""}
            </summary>
            <div className="flex flex-wrap gap-x-4 pb-2">
              {g.platforms.map((p) => (
                <label key={p.id} className="inline-flex min-h-11 min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                  <input type="checkbox" checked={selected.has(p.id)} disabled={full && !selected.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </details>
        );
      })}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </fieldset>
  );
}
