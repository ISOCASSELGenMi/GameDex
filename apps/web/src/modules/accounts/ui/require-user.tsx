"use client";
/**
 * 需要登入的帳號子頁外殼：在客戶端取 session；載入中／未登入（顯示登入提示與回跳連結）／已登入才渲染 children。
 * 停權帳號（D83）：只顯示「帳號已停權」說明；`allowSuspended`（隱私與資料頁：匯出、刪除）時說明放在內容上方。
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { getAccountStatus } from "./account-self-api";
import { getSession } from "./auth-api";
import { accountPageHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { SuspendedNotice } from "./suspended-notice";

type State = "loading" | "anonymous" | "user" | "suspended";

export function RequireUser({ strings, locale, children, allowSuspended = false }: { strings: AccountStrings; locale: string; children: ReactNode; allowSuspended?: boolean }): ReactElement {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (!res.ok || !res.data?.user) {
        if (alive) setState("anonymous");
        return;
      }
      const status = await getAccountStatus();
      if (alive) setState(status.ok && status.data?.suspended ? "suspended" : "user");
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state === "anonymous") {
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
