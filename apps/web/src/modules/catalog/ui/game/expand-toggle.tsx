"use client";
/**
 * 詳情頁的展開按鈕（簡介／故事的 More、相關內容的「查看另外 N 個版本」）。
 * 內容本身由伺服器渲染（HTML 一律完整，利於搜尋引擎與無 JS），這個元件只負責：
 * - 切換目標元素的 `data-open`（CSS 負責動畫與收合；內容不經過客戶端元件，避免 RSC payload 重複一份）
 * - `aria-expanded`／`aria-controls`
 * - kind="clamp"：量測目標是否超過收合高度，沒超過就不顯示按鈕（沒有 JS 時文字完整顯示）
 * - kind="panel"：展開後把焦點移到 focusId（相關內容標題）；網址 `#<targetId>` 直接展開
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";

export interface ExpandToggleProps {
  targetId: string;
  kind: "clamp" | "panel";
  labelClosed: string;
  labelOpen: string;
  /** kind="panel"：展開後要聚焦的元素 id。 */
  focusId?: string;
  className?: string;
  /** kind="clamp"：收合高度（em，需與 CSS 的 --rm-lines 一致）。 */
  clampLines?: number;
}

export function ExpandToggle({ targetId, kind, labelClosed, labelOpen, focusId, className, clampLines = 3 }: ExpandToggleProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  // clamp：量測後才知道要不要顯示；panel：一律顯示
  const [needed, setNeeded] = useState(kind === "panel");

  const apply = useCallback(
    (next: boolean, focus: boolean) => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.dataset.open = next ? "true" : "false";
      setOpen(next);
      if (next && focus && focusId) document.getElementById(focusId)?.focus();
    },
    [targetId, focusId],
  );

  useEffect(() => {
    if (kind !== "clamp") return;
    const target = document.getElementById(targetId);
    if (!target) return;
    let first = true;
    const measure = (): void => {
      // 先放開再量，才拿得到完整高度
      target.removeAttribute("data-clamp");
      const full = target.scrollHeight;
      const line = parseFloat(getComputedStyle(target).lineHeight) || 24;
      if (full > line * (clampLines + 0.75)) {
        target.style.setProperty("--rm-full", `${full}px`);
        target.setAttribute("data-clamp", "true");
        if (first) target.dataset.open = "false";
        setNeeded(true);
      } else {
        setNeeded(false);
      }
      first = false;
    };
    measure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = (): void => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [kind, targetId, clampLines]);

  useEffect(() => {
    if (kind !== "panel") return;
    const fromHash = (): void => {
      if (window.location.hash === `#${targetId}`) apply(true, true);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [kind, targetId, apply]);

  if (!needed) return null;
  return (
    <button
      type="button"
      className={className ?? "expand-btn"}
      aria-expanded={open}
      aria-controls={targetId}
      onClick={() => apply(!open, true)}
    >
      {open ? labelOpen : labelClosed}
    </button>
  );
}
