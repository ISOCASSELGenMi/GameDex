"use client";
/**
 * header.right 的客戶端元件（02 §UI slot、06 §SEO 與快取）：伺服器端 HTML 與使用者無關（可被 CDN 快取、不送 Set-Cookie），
 * 掛載後才向 `/api/v1/auth/get-session` 詢問登入狀態。
 * - 載入中：預留固定寬度的空位，避免版面跳動。
 * - 404（這個部署沒有啟用 accounts）：整個元件消失。
 * - 未登入：「登入」連結。登入後：名稱按鈕＋選單（我的帳號、登出）。
 */
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { getSession, signOut, type SessionUser } from "./auth-api";
import { accountPageHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type State = { kind: "loading" } | { kind: "disabled" } | { kind: "anonymous" } | { kind: "user"; user: SessionUser };

export function HeaderAccount({ locale, strings }: { locale: string; strings: AccountStrings }): ReactElement | null {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void getSession().then((res) => {
      if (!alive) return;
      if (res.status === 404) setState({ kind: "disabled" });
      else if (res.ok && res.data?.user) setState({ kind: "user", user: res.data.user });
      else setState({ kind: "anonymous" });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (state.kind === "disabled") return null;
  // 預留寬度：載入前後版面不跳動（登入連結與名稱按鈕都不超過 10rem）
  const slot = "inline-flex min-h-11 min-w-[7rem] items-center justify-end";
  if (state.kind === "loading") return <div className={slot} aria-hidden="true" data-account-slot="loading" />;
  if (state.kind === "anonymous") {
    return (
      <div className={slot} data-account-slot="anonymous">
        <a className="btn-secondary" href={accountPageHref(locale, "login")}>
          {str(strings, "header.signIn")}
        </a>
      </div>
    );
  }

  const user = state.user;
  async function onSignOut(): Promise<void> {
    setLeaving(true);
    await signOut();
    window.location.reload();
  }

  return (
    <div ref={rootRef} className={`${slot} relative`} data-account-slot="user">
      <button
        ref={buttonRef}
        type="button"
        className="btn-secondary max-w-40"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={str(strings, "header.menu", { name: user.name })}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{user.name}</span>
      </button>
      {open ? (
        <ul id={menuId} className="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-md border border-[var(--border)] bg-[var(--background)] p-1 shadow-lg">
          <li>
            <a className="link-quiet flex min-h-11 items-center rounded px-3 hover:bg-[var(--surface)]" href={accountPageHref(locale, "account")}>
              {str(strings, "header.account")}
            </a>
          </li>
          <li>
            <button type="button" className="link-quiet flex min-h-11 w-full items-center rounded px-3 text-left hover:bg-[var(--surface)]" disabled={leaving} onClick={() => void onSignOut()}>
              {leaving ? str(strings, "header.signingOut") : str(strings, "header.signOut")}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
