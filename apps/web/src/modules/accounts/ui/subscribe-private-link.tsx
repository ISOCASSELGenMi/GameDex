"use client";
/** 公開訂閱頁的私人行事曆入口：已登入才顯示（伺服器 HTML 不含使用者資訊，也不含這段內容）。 */
import type { ReactElement } from "react";
import { accountPrivateCalendarHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { useSessionState } from "./follow-button";

export function SubscribePrivateLink({ locale, strings }: { locale: string; strings: AccountStrings }): ReactElement | null {
  const session = useSessionState();
  if (session !== "user") return null;
  return (
    <aside className="notice mt-8 max-w-3xl" data-section="private-feed">
      <p>{str(strings, "follow.private.text")}</p>
      <p className="mt-1">
        <a className="link inline-flex min-h-11 items-center" href={accountPrivateCalendarHref(locale)}>
          {str(strings, "follow.private.link")}
        </a>
      </p>
    </aside>
  );
}
