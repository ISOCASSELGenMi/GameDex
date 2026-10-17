"use client";
/**
 * 窄螢幕（< 768px）的 header 收合式選單：品牌旁一個選單按鈕，展開後顯示主導覽、語言、登入／帳號入口。
 * - 沒有 JS（或尚未水合）時面板一律展開（與改版前相同：導覽列自動換行），按鈕不顯示。
 * - 水合後：按鈕 aria-expanded／aria-controls；Esc 關閉並把焦點還給按鈕；點選面板內連結、點面板外、視窗放大到桌機寬度都會關閉。
 * - 開合動畫為 CSS（grid-template-rows 0fr↔1fr），只在 prefers-reduced-motion: no-preference。
 * - 桌機（≥ 768px）面板以 display: contents 融入 header 的同一列。
 * 伺服器 HTML 與使用者無關：登入狀態仍由 children 裡的 header.right slot 在客戶端取得。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useHydrated } from "../calendar/use-day-cards";

export function HeaderMenu({ label, children }: { label: string; children: ReactNode }): ReactElement {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    const mq = window.matchMedia("(min-width: 768px)");
    const onResize = () => {
      if (mq.matches) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    mq.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      mq.removeEventListener("change", onResize);
    };
  }, [open, close]);

  return (
    <span ref={rootRef} className="hm-root" data-header-menu="">
      <button
        ref={buttonRef}
        type="button"
        className="hm-toggle"
        hidden={!hydrated}
        aria-expanded={open}
        aria-controls="site-menu"
        data-menu-toggle=""
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hm-icon" aria-hidden="true" data-open={open ? "true" : undefined} />
        <span>{label}</span>
      </button>
      <div
        id="site-menu"
        className="hm-panel"
        data-collapsible={hydrated ? "true" : undefined}
        data-open={open ? "true" : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) close(false);
        }}
      >
        <div className="hm-inner">{children}</div>
      </div>
    </span>
  );
}
