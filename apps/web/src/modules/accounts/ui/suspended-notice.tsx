"use client";
/** 「帳號已停權」說明（D83）：停權者可登入，但只能看這段說明、匯出資料、刪除帳號。各帳號子頁與帳號首頁共用。 */
import type { ReactElement } from "react";
import { accountPrivacyHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function SuspendedNotice({ strings, locale, showPrivacyLink = true }: { strings: AccountStrings; locale: string; showPrivacyLink?: boolean }): ReactElement {
  return (
    <section role="status" data-account-suspended="" className="notice flex flex-col gap-2">
      <h2 className="text-xl font-bold">{str(strings, "suspended.title")}</h2>
      <p>{str(strings, "suspended.body")}</p>
      {showPrivacyLink ? (
        <p>
          <a className="link inline-flex min-h-11 items-center" href={accountPrivacyHref(locale)}>
            {str(strings, "suspended.toPrivacy")}
          </a>
        </p>
      ) : null}
    </section>
  );
}
