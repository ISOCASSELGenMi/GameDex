"use client";
/** 破壞性動作的行內確認：第一次按顯示「確定？」與確認／取消，確認後才執行 onConfirm。 */
import { useState, type ReactElement } from "react";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export interface ConfirmButtonProps {
  strings: AccountStrings;
  /** 按鈕文字（例如「刪除」）。 */
  label: string;
  /** 螢幕閱讀器補充（例如項目名稱），讓同一頁多個「刪除」可分辨。 */
  srContext?: string;
  confirmText: string;
  /** 確認鈕文字；省略＝「確定刪除」。 */
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmButton({ strings, label, srContext, confirmText, confirmLabel, onConfirm }: ConfirmButtonProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
        {label}
        {srContext ? <span className="sr-only"> {srContext}</span> : null}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span role="alert" className="text-sm">
        {confirmText}
      </span>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run()}>
        {confirmLabel ?? str(strings, "common.confirmDelete")}
        {srContext ? <span className="sr-only"> {srContext}</span> : null}
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
        {str(strings, "common.cancel")}
      </button>
    </span>
  );
}
