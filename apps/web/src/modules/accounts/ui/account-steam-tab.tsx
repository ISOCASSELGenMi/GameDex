"use client";
/** `/[locale]/account/steam`（Steam 遊戲庫分頁）：已綁定 Steam 才顯示遊戲庫；還沒綁定就說明並提供綁定按鈕。 */
import { useEffect, useState, type ReactElement } from "react";
import { useAccountSession } from "./account-session";
import { listAccounts } from "./auth-api";
import { SteamLibrary } from "./steam-library";
import { LinkSteamButton } from "./steam-link";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function AccountSteamTab({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement | null {
  const session = useAccountSession();
  const active = session?.kind === "user" && !session.suspended;
  const [linked, setLinked] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void listAccounts().then((res) => {
      if (alive) setLinked(res.ok && Array.isArray(res.data) ? res.data.some((a) => a.providerId === "steam") : false);
    });
    return () => {
      alive = false;
    };
  }, [active]);

  if (!active) return null;
  if (linked === null) return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (linked) return <SteamLibrary strings={strings} locale={locale} pageHeading />;
  return (
    <section aria-labelledby="steam-link-heading" className="flex flex-col gap-3">
      <h1 id="steam-link-heading" className="text-2xl font-bold">
        {str(strings, "steam.title")}
      </h1>
      <p>{str(strings, "steam.notLinked")}</p>
      {error ? (
        <p role="alert" className="notice text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <p>
        <LinkSteamButton strings={strings} returnTo={`/${locale}/account/steam`} onError={setError} />
      </p>
    </section>
  );
}
