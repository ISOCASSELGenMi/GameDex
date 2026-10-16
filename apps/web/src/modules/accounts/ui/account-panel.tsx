"use client";
/** `/[locale]/account` 骨架：顯示名稱、信箱（placeholder 不顯示）、已綁定登入方式（排除 credential）、登出。 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { isExternalProvider } from "../domain/entities/providers";
import { isPlaceholderEmail } from "../domain/entities/email";
import { getSession, listAccounts, signInSteam, signOut, unlinkAccount, type LinkedAccountRow, type SessionUser } from "./auth-api";
import { accountListsHref, accountPageHref, accountPlaysHref } from "./links";
import { oauthErrorText } from "./oauth-error";
import { SteamLibrary } from "./steam-library";
import { useSearchParam } from "./use-search-param";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type State = { kind: "loading" } | { kind: "anonymous" } | { kind: "user"; user: SessionUser };

export function AccountPanel({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [linked, setLinked] = useState<LinkedAccountRow[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [linking, setLinking] = useState(false);
  // Steam／OAuth 綁定失敗會帶 ?error= 回來（在客戶端讀，伺服器端 HTML 與使用者、網址無關）
  const returnedError = useSearchParam("error");

  const loadLinked = useCallback(async () => {
    const res = await listAccounts();
    if (res.ok && Array.isArray(res.data)) setLinked(res.data.filter((a) => isExternalProvider(a.providerId)));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (!alive) return;
      if (res.ok && res.data?.user) {
        setState({ kind: "user", user: res.data.user });
        await loadLinked();
      } else setState({ kind: "anonymous" });
    })();
    return () => {
      alive = false;
    };
  }, [loadLinked]);

  if (state.kind === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state.kind === "anonymous") {
    return (
      <div className="flex flex-col gap-3">
        {returnedError ? <p role="alert" className="notice text-[var(--danger)]">{oauthErrorText(strings, returnedError)}</p> : null}
        <h2 className="text-xl font-bold">{str(strings, "account.signedOutTitle")}</h2>
        <p>{str(strings, "account.signedOutBody")}</p>
        <p>
          <a className="btn-primary" href={accountPageHref(locale, "login", `next=${encodeURIComponent(accountPageHref(locale, "account"))}`)}>
            {str(strings, "account.signIn")}
          </a>
        </p>
      </div>
    );
  }

  const user = state.user;
  const showEmail = !isPlaceholderEmail(user.email);
  const steamLinked = linked.some((a) => a.providerId === "steam");

  async function onUnlink(row: LinkedAccountRow): Promise<void> {
    setMessage(null);
    const provider = str(strings, `providers.${row.providerId}`);
    const res = await unlinkAccount(row.id);
    if (res.ok) {
      setMessage({ tone: "ok", text: str(strings, "account.unlinked", { provider }) });
      await loadLinked();
    } else if (res.code === "FAILED_TO_UNLINK_LAST_ACCOUNT") setMessage({ tone: "error", text: str(strings, "account.error.unlinkLast") });
    else if (res.status === 403 || res.status === 401) setMessage({ tone: "error", text: str(strings, "account.error.notFresh") });
    else setMessage({ tone: "error", text: res.network ? str(strings, "common.network") : str(strings, "common.generic") });
  }

  async function onLinkSteam(): Promise<void> {
    setLinking(true);
    setMessage(null);
    const here = accountPageHref(locale, "account");
    const res = await signInSteam(here, here);
    if (res.ok && res.data?.url) {
      window.location.assign(res.data.url);
      return;
    }
    setLinking(false);
    setMessage({ tone: "error", text: res.network ? str(strings, "common.network") : res.status === 429 ? str(strings, "common.rateLimited") : str(strings, "login.error.steamInvalid") });
  }

  async function onSignOut(): Promise<void> {
    setLeaving(true);
    await signOut();
    window.location.assign(accountPageHref(locale, "login"));
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="font-semibold">{str(strings, "account.name")}</dt>
        <dd data-testid="account-name" className="min-w-0 [overflow-wrap:anywhere]">{user.name}</dd>
        <dt className="font-semibold">{str(strings, "account.email")}</dt>
        <dd data-testid="account-email" className="min-w-0 [overflow-wrap:anywhere]">
          {showEmail ? (
            <>
              {user.email}
              {user.emailVerified ? "" : <span className="text-[var(--muted)]"> {str(strings, "account.emailUnverified")}</span>}
            </>
          ) : (
            <span className="text-[var(--muted)]">{str(strings, "account.emailNone")}</span>
          )}
        </dd>
      </dl>

      <section aria-labelledby="mine-heading" className="flex flex-col gap-2">
        <h2 id="mine-heading" className="text-xl font-bold">
          {str(strings, "account.mine.title")}
        </h2>
        <p className="text-sm text-[var(--muted)]">{str(strings, "account.mine.hint")}</p>
        <ul className="flex flex-col gap-1">
          <li>
            <a className="link inline-flex min-h-11 items-center" href={accountListsHref(locale)}>
              {str(strings, "account.mine.lists")}
            </a>
          </li>
          <li>
            <a className="link inline-flex min-h-11 items-center" href={accountPlaysHref(locale)}>
              {str(strings, "account.mine.plays")}
            </a>
          </li>
        </ul>
      </section>

      <section aria-labelledby="linked-heading" className="flex flex-col gap-2">
        <h2 id="linked-heading" className="text-xl font-bold">
          {str(strings, "account.linked")}
        </h2>
        <p className="text-sm text-[var(--muted)]">{str(strings, "account.linkedHint")}</p>
        {returnedError && !message ? (
          <p role="alert" className="notice text-[var(--danger)]">
            {oauthErrorText(strings, returnedError)}
          </p>
        ) : null}
        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={`notice ${message.tone === "error" ? "text-[var(--danger)]" : ""}`}>
            {message.text}
          </p>
        ) : null}
        {linked.length === 0 ? (
          <p>{str(strings, "account.linkedNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linked.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-1">
                <span>{str(strings, `providers.${row.providerId}`)}</span>
                <button type="button" className="btn-secondary" aria-label={str(strings, "account.unlinkAria", { provider: str(strings, `providers.${row.providerId}`) })} onClick={() => void onUnlink(row)}>
                  {str(strings, "account.unlink")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!steamLinked ? (
          <p>
            <button type="button" className="btn-secondary" disabled={linking} onClick={() => void onLinkSteam()}>
              {str(strings, "account.linkSteam")}
            </button>
          </p>
        ) : null}
      </section>

      {steamLinked ? <SteamLibrary strings={strings} locale={locale} /> : null}

      <p>
        <button type="button" className="btn-secondary" disabled={leaving} onClick={() => void onSignOut()}>
          {leaving ? str(strings, "account.signingOut") : str(strings, "account.signOut")}
        </button>
      </p>
    </div>
  );
}
