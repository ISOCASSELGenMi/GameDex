"use client";
/**
 * header 共用下拉元件（導覽、主題、語言、帳號共用同一個）。disclosure 模式：
 * - 觸發按鈕 `aria-expanded`／`aria-controls`（面板一直在 DOM 裡，關閉時 `visibility: hidden`，讀屏與 Tab 都略過）。
 * - Esc 關閉並把焦點還給按鈕；點外面關閉；Tab 離開面板時關閉；方向鍵 ↑↓／Home／End 在項目間移動，
 *   觸發按鈕上按 ↓ 開啟並移到第一項。同時只開一個（開啟時廣播 DROPDOWN_OPEN_EVENT）。
 * - 動畫（globals.css）：透明度＋縮放 0.96，從觸發按鈕那一側長出；關閉比開啟快。鍵盤開啟（click 的 detail 為 0）不做動畫。
 * 面板內容由呼叫端提供（連結或按鈕）；點到面板內的連結會自動關閉，按鈕請用 useDropdownClose()。
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { DROPDOWN_ITEM_SELECTOR, DROPDOWN_OPEN_EVENT, nextDropdownIndex } from "./dropdown-keys";

type CloseFn = (restoreFocus?: boolean) => void;

const DropdownCloseContext = createContext<CloseFn>(() => {});

/** 面板內的按鈕用它關閉選單（restoreFocus＝把焦點還給觸發按鈕）；連結點擊會自動關閉，不必用。 */
export function useDropdownClose(): CloseFn {
  return useContext(DropdownCloseContext);
}

export interface DropdownProps {
  /** 穩定識別字（data-dropdown；也是「同時只開一個」的鍵）。 */
  name: string;
  /** 觸發按鈕的可及名稱。 */
  label: string;
  icon: ReactNode;
  /** 面板對齊觸發按鈕的哪一側（靠右的按鈕用 end，面板從右上角長出）。 */
  align?: "start" | "end";
  /** 面板的 aria-label（選填）。 */
  panelLabel?: string;
  children: ReactNode;
}

const noopSubscribe = () => () => {};

export function Dropdown({ name, label, icon, align = "start", panelLabel, children }: DropdownProps): ReactElement {
  const panelId = useId();
  // 水合完成才為 true（e2e 與腳本據此知道按鈕已可操作）
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const items = useCallback((): HTMLElement[] => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(DROPDOWN_ITEM_SELECTOR) ?? []), []);

  const openMenu = useCallback(
    (viaKeyboard: boolean) => {
      setInstant(viaKeyboard);
      setOpen(true);
      window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVENT, { detail: name }));
    },
    [name],
  );

  // 別的下拉打開了 → 關閉自己
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== name) setOpen(false);
    };
    window.addEventListener(DROPDOWN_OPEN_EVENT, onOther);
    return () => window.removeEventListener(DROPDOWN_OPEN_EVENT, onOther);
  }, [name]);

  // 點外面關閉
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // 鍵盤打開（↓）→ 面板顯示後把焦點移到第一項
  useEffect(() => {
    if (open && focusFirstRef.current) {
      focusFirstRef.current = false;
      items()[0]?.focus();
    }
  }, [open, items]);

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (open) items()[0]?.focus();
      else {
        focusFirstRef.current = true;
        openMenu(true);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const list = items();
    const next = nextDropdownIndex(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className="dd-root"
      data-dropdown={name}
      data-ready={ready ? "true" : undefined}
      onBlur={(e) => {
        // Tab 離開整個下拉 → 關閉（relatedTarget 為 null 的點擊由 pointerdown 處理）
        const to = e.relatedTarget as Node | null;
        if (to && rootRef.current && !rootRef.current.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="dd-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        data-dropdown-trigger=""
        onClick={(e) => (open ? close() : openMenu(e.detail === 0))}
        onKeyDown={onButtonKeyDown}
      >
        {icon}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="dd-panel"
        role={panelLabel ? "group" : undefined}
        aria-label={panelLabel}
        data-align={align}
        data-open={open ? "true" : undefined}
        data-instant={instant ? "true" : undefined}
        onKeyDown={onPanelKeyDown}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href]")) close();
        }}
      >
        <DropdownCloseContext.Provider value={close}>{children}</DropdownCloseContext.Provider>
      </div>
    </div>
  );
}
