/**
 * 月曆「遊戲／活動」顯示開關的純邏輯（GameDex 第 2 輪）：狀態 ↔ 網址 `show` 參數。
 * 預設只開遊戲（不寫進網址）；`show=events`＝只看活動；`show=events,releases`＝兩者（參數值排序後的正規形式）。
 * 兩個都關不允許：最後一個開著的開關不能關掉（UI 以 aria-disabled 呈現並說明）。
 */
import type { FilterSpec } from "@sok/api-contract";
import { DEFAULT_SHOW, showFromSpec, type ShowSet } from "../filter-mapping";

export type ShowKind = "releases" | "events";
export const SHOW_KINDS: readonly ShowKind[] = ["releases", "events"];

/** 把開關狀態寫回 FilterSpec：預設狀態（只有遊戲）省略 `show`。 */
export function specWithShow(spec: FilterSpec, show: ShowSet): FilterSpec {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) if (k !== "show") rest[k] = v;
  const onlyDefault = (show.releases && !show.events) || (!show.releases && !show.events);
  if (onlyDefault) return rest as FilterSpec;
  // FilterSpec 多值維度的正規形式是值排序後（events 在 releases 前）
  return { ...rest, show: show.releases ? ["events", "releases"] : ["events"] } as FilterSpec;
}

/** 按下某個開關後的新狀態；會讓兩個都關則回 null（不允許）。 */
export function toggledShow(show: ShowSet, kind: ShowKind): ShowSet | null {
  const next: ShowSet = { ...show, [kind]: !show[kind] };
  return next.releases || next.events ? next : null;
}

export interface ShowSwitchModel {
  kind: ShowKind;
  checked: boolean;
  /** 按下後的 FilterSpec；null＝不可切換（最後一個開著的）。 */
  nextSpec: FilterSpec | null;
}

export function showSwitchModels(spec: FilterSpec): ShowSwitchModel[] {
  const show = showFromSpec(spec);
  return SHOW_KINDS.map((kind) => {
    const next = toggledShow(show, kind);
    return { kind, checked: show[kind], nextSpec: next ? specWithShow(spec, next) : null };
  });
}

export { DEFAULT_SHOW };
