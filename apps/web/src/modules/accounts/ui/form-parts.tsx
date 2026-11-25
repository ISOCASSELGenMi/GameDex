/**
 * 帳號表單共用的小元件（客戶端與伺服器端都可 import；沒有狀態）。
 * 欄位：label＋控制項＋說明＋錯誤（aria-describedby 連結）。
 */
import type { ReactElement, ReactNode } from "react";

export const CONTROL_CLASS = "min-h-8 text-sm w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3";

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactElement;
}

export function Field({ id, label, hint, error, children }: FieldProps): ReactElement {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 表單層級的錯誤（role=alert，送出後立刻朗讀）。 */
export function FormError({ children }: { children: ReactNode }): ReactElement | null {
  if (!children) return null;
  return (
    <p role="alert" className="notice text-[var(--danger)]">
      {children}
    </p>
  );
}
