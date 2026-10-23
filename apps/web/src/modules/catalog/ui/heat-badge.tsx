/**
 * 熱度徽章（06 §熱度顯示）：圖示＋文字（「熱度 4/5」）；heatLevel 0 不顯示；不只靠顏色。
 * - 完整（詳情頁、預覽卡、熱門榜）：火焰圖示＋可見文字。
 * - 精簡（月曆格子、時間軸卡片）：火焰圖示＋等級數字，整體 role="img"＋aria-label（可及名稱＝完整文字）。
 * 沒有 hooks、不讀字典：伺服器與客戶端元件都可用（文字由呼叫端以 heatBadgeLabel 取得後傳入）。
 */
import type { ReactElement } from "react";
import { formatNumber, type Locale, type Translator } from "@sok/i18n";

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

const FLAME_PATH =
  "M8.6 1c.4 2.1-.4 3.3-1.3 4.4C6.4 6.5 5.5 7.5 5.8 9.3c-.9-.4-1.4-1.2-1.5-2.2C3.5 8 3 9.2 3 10.5 3 13 5.2 15 8 15s5-2 5-4.6c0-2.3-1.2-3.6-2.3-4.8C9.7 4.5 8.8 3.4 8.6 1Zm-.4 7.6c.2 1.1.9 1.6 1.4 2.2.4.4.7.9.7 1.5 0 1-.9 1.7-2.1 1.7S6.1 13.3 6.1 12.3c0-.9.5-1.4 1-1.9.5-.5 1-1 1.1-1.8Z";

/**
 * 一頁有很多徽章時（首頁 48 張卡）：頁面放一份 <HeatSprite id>，徽章傳 spriteId 改用 <use> 參照，
 * 每個徽章省下約 600 bytes（伺服器 HTML 與 RSC payload 各一份）。
 */
export function HeatSprite({ id }: { id: string }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
      <symbol id={id} viewBox="0 0 16 16">
        <path d={FLAME_PATH} />
      </symbol>
    </svg>
  );
}

function FlameIcon({ spriteId }: { spriteId?: string }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="heat-ico" fill="currentColor">
      {spriteId ? <use href={`#${spriteId}`} /> : <path d={FLAME_PATH} />}
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
  /** 頁面有 <HeatSprite id> 時傳入其 id，火焰圖示改用 <use> 參照（省 HTML 大小）。 */
  spriteId?: string;
}

export function HeatBadge({ level, label, compact = false, className, spriteId }: HeatBadgeProps): ReactElement | null {
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
        <FlameIcon spriteId={spriteId} />
        <span aria-hidden="true">{v}</span>
      </span>
    );
  }
  return (
    <span
      data-heat={v}
      className={["heat-full", className].filter(Boolean).join(" ")}
    >
      <FlameIcon spriteId={spriteId} />
      <span>{label}</span>
    </span>
  );
}

/**
 * 站內追蹤人數（Phase 7 第 6 波，06 §熱度顯示）：「1.2K 人追蹤」。只在 followerCount 為正整數時有文字（null／0／非法＝不顯示）。
 * 數字用 compact 格式（唯一實作在這裡；伺服器與測試共用）。
 */
export function followerCountLabel(t: Translator, locale: Locale, count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return null;
  return t.t("ui.heat.followers", { count: formatNumber(Math.floor(count), locale, { notation: "compact" }) });
}

function TrendUpIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0 align-[-0.125em]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 11.5 6 7.5l2.5 2.5L14 4.5" />
      <path d="M10 4.5h4v4" />
    </svg>
  );
}

/** 「上升中」標記（不是膠囊；圖示＋文字，不只靠顏色）。 */
export function RisingMark({ label }: { label: string }): ReactElement {
  return (
    <span data-rising="" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)]">
      <TrendUpIcon />
      <span>{label}</span>
    </span>
  );
}
