"use client";
/**
 * 需要登入的帳號子頁外殼：在客戶端取 session；載入中／未登入（顯示登入提示與回跳連結）／已登入才渲染 children。
 * 停權帳號（D83）：只顯示「帳號已停權」說明；`allowSuspended`（隱私與資料頁：匯出、刪除）時說明放在內容上方。
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useAccountSession } from "./account-session";
import { getAccountStatus } from "./account-self-api";
import { getSession } from "./auth-api";
import { accountPageHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { SuspendedNotice } from "./suspended-notice";

type State = "loading" | "anonymous" | "user" | "suspended";

export function RequireUser({ strings, locale, children, allowSuspended = false }: { strings: AccountStrings; locale: string; children: ReactNode; allowSuspended?: boolean }): ReactElement {
  const shell = useAccountSession();
  const [own, setOwn] = useState<State>("loading");

  useEffect(() => {
    // 在帳號頁殼底下時，登入狀態由殼提供（不重複請求）
    if (shell) return;
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (!res.ok || !res.data?.user) {
        if (alive) setOwn("anonymous");
        return;
      }
      const status = await getAccountStatus();
      if (alive) setOwn(status.ok && status.data?.suspended ? "suspended" : "user");
    })();
    return () => {
      alive = false;
    };
  }, [shell]);

  const state: State = shell ? (shell.kind === "user" ? (shell.suspended ? "suspended" : "user") : shell.kind) : own;
  // 殼已經在上方顯示停權說明與登入提示，這裡不重複
  const inShell = shell !== null;

  if (state === "loading") return inShell ? <></> : <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state === "anonymous") {
    if (inShell) return <></>;
    const here = typeof window === "undefined" ? `/${locale}/account` : `${window.location.pathname}${window.location.search}`;
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{str(strings, "account.signedOutTitle")}</h2>
        <p>{str(strings, "account.signedOutBody")}</p>
        <p>
          <a className="btn-primary" href={accountPageHref(locale, "login", `next=${encodeURIComponent(here)}`)}>
            {str(strings, "account.signIn")}
          </a>
        </p>
      </div>
    );
  }
  if (state === "suspended") {
    if (inShell) return allowSuspended ? <div className="flex min-w-0 flex-col gap-6">{children}</div> : <></>;
    return allowSuspended ? (
      <div className="flex min-w-0 flex-col gap-6">
        <SuspendedNotice strings={strings} locale={locale} showPrivacyLink={false} />
        {children}
      </div>
    ) : (
      <SuspendedNotice strings={strings} locale={locale} />
    );
  }
  return <>{children}</>;
}
