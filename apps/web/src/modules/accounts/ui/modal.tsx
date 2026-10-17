"use client";
/**
 * 對話框（原生 <dialog> + showModal）：焦點移入、背景 inert、Esc 關閉；關閉後焦點回到開啟它的按鈕（瀏覽器原生行為）。
 * <dialog> 永遠掛在 DOM 裡，內容只在開啟時渲染（表單狀態因此在每次開啟時重置）。
 * 內部容器 `relative` 並可捲動（內容含 sr-only 時不會撐出頁面）。
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, closeLabel, children }: ModalProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-auto w-[min(34rem,calc(100vw-1rem))] max-w-none rounded-lg border border-[var(--border)] bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/45"
      onClose={onClose}
    >
      {open ? (
        <div className="relative flex max-h-[90dvh] flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2">
            <h2 id={titleId} className="min-w-0 text-lg font-bold [overflow-wrap:anywhere]">
              {title}
            </h2>
            <button type="button" className="btn-secondary shrink-0" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
          <div className="flex min-w-0 flex-col gap-3 p-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
