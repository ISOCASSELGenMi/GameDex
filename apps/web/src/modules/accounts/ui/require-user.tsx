"use client";
/** 需要登入的帳號子頁外殼：在客戶端取 session；載入中／未登入（顯示登入提示與回跳連結）／已登入才渲染 children。 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { getSession } from "./auth-api";
import { accountPageHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type State = "loading" | "anonymous" | "user";

export function RequireUser({ strings, locale, children }: { strings: AccountStrings; locale: string; children: ReactNode }): ReactElement {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (alive) setState(res.ok && res.data?.user ? "user" : "anonymous");
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
  return <>{children}</>;
}
