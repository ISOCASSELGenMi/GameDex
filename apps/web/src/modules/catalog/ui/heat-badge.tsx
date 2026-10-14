/**
 * 熱度徽章（06 §熱度顯示）：圖示＋文字（「熱度 4/5」）；heatLevel 0 不顯示；不只靠顏色。
 * - 完整（詳情頁、預覽卡、熱門榜）：火焰圖示＋可見文字。
 * - 精簡（月曆格子、時間軸卡片）：火焰圖示＋等級數字，整體 role="img"＋aria-label（可及名稱＝完整文字）。
 * 沒有 hooks、不讀字典：伺服器與客戶端元件都可用（文字由呼叫端以 heatBadgeLabel 取得後傳入）。
 */
import type { ReactElement } from "react";
import type { Translator } from "@sok/i18n";

/** 熱度等級上限（heatLevel 0~5）。 */
export const HEAT_LEVEL_MAX = 5;

/** 是否顯示徽章：1~5 才顯示（0＝不顯示）。 */
export function hasHeatBadge(level: number | null | undefined): level is number {
  return typeof level === "number" && Number.isFinite(level) && level >= 1;
}

/** 「熱度 4/5」；heatLevel 0（或非法值）回 null。 */
export function heatBadgeLabel(t: Translator, level: number | null | undefined): string | null {
  if (!hasHeatBadge(level)) return null;
  const v = Math.min(HEAT_LEVEL_MAX, Math.floor(level));
  return t.t("ui.heat.label", { level: v, max: HEAT_LEVEL_MAX });
}

function FlameIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0 align-[-0.125em]" fill="currentColor">
      <path d="M8.6 1c.4 2.1-.4 3.3-1.3 4.4C6.4 6.5 5.5 7.5 5.8 9.3c-.9-.4-1.4-1.2-1.5-2.2C3.5 8 3 9.2 3 10.5 3 13 5.2 15 8 15s5-2 5-4.6c0-2.3-1.2-3.6-2.3-4.8C9.7 4.5 8.8 3.4 8.6 1Zm-.4 7.6c.2 1.1.9 1.6 1.4 2.2.4.4.7.9.7 1.5 0 1-.9 1.7-2.1 1.7S6.1 13.3 6.1 12.3c0-.9.5-1.4 1-1.9.5-.5 1-1 1.1-1.8Z" />
    </svg>
  );
}

export interface HeatBadgeProps {
  level: number | null | undefined;
  /** heatBadgeLabel 的結果（「熱度 4/5」）。 */
  label: string | null;
  /** 精簡（只顯示圖示＋數字；可及名稱仍是完整文字）。 */
  compact?: boolean;
  className?: string;
}

export function HeatBadge({ level, label, compact = false, className }: HeatBadgeProps): ReactElement | null {
  if (!hasHeatBadge(level) || !label) return null;
  const v = Math.min(HEAT_LEVEL_MAX, Math.floor(level));
  if (compact) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-heat={v}
        className={["inline-flex items-center gap-px text-xs font-bold text-[var(--warn)]", className].filter(Boolean).join(" ")}
      >
        <FlameIcon />
        <span aria-hidden="true">{v}</span>
      </span>
    );
  }
  return (
    <span
      data-heat={v}
      className={[
        "inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 text-sm font-semibold text-[var(--warn)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <FlameIcon />
      <span>{label}</span>
    </span>
  );
}
