"use client";
/**
 * 篩選面板的外框（06 §篩選 UI：桌機展開面板、手機「篩選（n）」底部抽屜）。
 * - 伺服器輸出與沒有 JS 時：<details>（桌機與手機都是就地展開，原生可及）。
 * - 有 JS 且視窗寬度 < 768px：改成按鈕＋原生 <dialog>（showModal）底部抽屜：
 *   焦點移入（第一個可聚焦元素＝關閉鈕）、背景 inert、Esc 關閉、關閉後焦點回到按鈕（瀏覽器原生行為，另外補一次保險）。
 *   送出表單後自動關閉。
 * 表單內容（children）同一時間只渲染在一個位置，不會有重複的 id／欄位。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

export interface FilterDrawerProps {
  /** 「篩選」或「篩選（n）」。 */
  summary: string;
  /** 抽屜標題（通常同 summary）。 */
  title: string;
  closeLabel: string;
  /** 已套用的篩選值數量（徽章；0 不顯示）。 */
  count?: number;
  children: ReactNode;
}

/** 篩選圖示（三條滑桿）＋ 視覺隱藏的文字（無障礙名稱與測試仍是「篩選（n）」）＋ 數量徽章。 */
function FilterButtonFace({ text, count }: { text: string; count: number }): ReactElement {
  return (
    <>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M1 3h8v1.5H1V3Zm10 0h4v1.5h-4V3ZM9 1.75h2v4H9v-4ZM1 7.25h4v1.5H1v-1.5Zm6 0h8v1.5H7v-1.5ZM5 6h2v4H5V6ZM1 11.5h9V13H1v-1.5Zm11 0h3V13h-3v-1.5ZM10 10.25h2v4h-2v-4Z" />
      </svg>
      <span className="sr-only">{text}</span>
      {count > 0 ? (
        <span className="filter-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </>
  );
}

export function FilterDrawer({ summary, title, closeLabel, count = 0, children }: FilterDrawerProps): ReactElement {
  const [mobile, setMobile] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // 浮出式面板（精簡工具列內）：點面板外面或按 Esc 關閉，Esc 後焦點回到按鈕
  useEffect(() => {
    const d = detailsRef.current;
    if (mobile || !d?.closest(".tb-row")) return;
    const onDown = (e: PointerEvent) => {
      if (d.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !d.open) return;
      d.open = false;
      d.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobile]);

  const close = useCallback(() => {
    const d = dialogRef.current;
    if (d?.open) d.close();
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      const b = buttonRef.current;
      if (b && b.isConnected && document.activeElement !== b) b.focus();
    };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [mobile]);

  if (!mobile) {
    return (
      <details ref={detailsRef} className="filter-panel" data-filter-panel="">
        <summary className="filter-summary" title={summary}>
          <FilterButtonFace text={summary} count={count} />
        </summary>
        {children}
      </details>
    );
  }

  return (
    <div data-filter-panel="">
      <button
        ref={buttonRef}
        type="button"
        className="filter-summary"
        title={summary}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <FilterButtonFace text={summary} count={count} />
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="filter-drawer-title"
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-xl border-t border-[var(--border)] bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/45"
        onClick={(e) => {
          if (e.target === e.currentTarget) close(); // 點背景關閉
        }}
        onSubmit={() => {
          // next/form 已攔截送出並導覽；關閉抽屜
          setTimeout(close, 0);
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2">
          <h2 id="filter-drawer-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className="btn-secondary" onClick={close}>
            {closeLabel}
          </button>
        </div>
        <div className="px-2 pb-4">{children}</div>
      </dialog>
    </div>
  );
}
