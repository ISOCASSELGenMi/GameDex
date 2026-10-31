"use client";
/**
 * 游標微動畫（全站一個委派監聽，不為每張卡片各掛一個）：
 * - 偽 3D 傾斜：游標在卡片上移動時，卡片依游標位置轉動 ≤ 6°（--rx／--ry），封面圖反向微移（--px／--py，視差）。
 * - 只在「細緻指標＋可 hover」的裝置、且沒有 prefers-reduced-motion 時啟用；觸控與減少動態的使用者完全不跑。
 * - 只寫 CSS 變數與 data-tilting 屬性，樣式在 globals.css（最後一段）；不碰 React 管的節點內容。
 */
import { useEffect } from "react";

const TARGET = ".summary-card, .rc-card-link, .cal-link, .detail-cover";
const MAX_DEG = 6;

/** 觸控裝置：第一次輕觸分組卡片只浮現名稱資訊（不進入），再輕觸一次才進入；輕觸別處收起。 */
function useTouchReveal(): void {
  useEffect(() => {
    if (!window.matchMedia("(hover: none)").matches) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest<HTMLElement>(".rc-card-link") ?? null;
      document.querySelectorAll(".rc-card-link[data-open]").forEach((el) => {
        if (el !== link) el.removeAttribute("data-open");
      });
      if (link && !link.hasAttribute("data-open")) {
        e.preventDefault();
        link.setAttribute("data-open", "");
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

export function PointerFx(): null {
  useTouchReveal();
  useEffect(() => {
    const ok = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!ok.matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;

    const reset = (el: HTMLElement | null) => {
      if (!el) return;
      el.removeAttribute("data-tilting");
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGET) ?? null;
      if (el !== current) {
        reset(current);
        current = el;
      }
      if (!el) return;
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const x = (clientX - r.left) / r.width - 0.5; // -0.5 … 0.5
        const y = (clientY - r.top) / r.height - 0.5;
        el.setAttribute("data-tilting", "");
        el.style.setProperty("--rx", `${(-y * 2 * MAX_DEG).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * 2 * MAX_DEG).toFixed(2)}deg`);
        el.style.setProperty("--px", (x * 2).toFixed(3));
        el.style.setProperty("--py", (y * 2).toFixed(3));
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      reset(current);
      current = null;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      onLeave();
    };
  }, []);
  return null;
}
