"use client";
/** `/[locale]/account` 骨架：顯示名稱、信箱（placeholder 不顯示）、已綁定登入方式（排除 credential）、登出。 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { isExternalProvider } from "../domain/entities/providers";
import { isPlaceholderEmail } from "../domain/entities/email";
import { getSession, listAccounts, signOut, unlinkAccount, type LinkedAccountRow, type SessionUser } from "./auth-api";
import { accountPageHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type State = { kind: "loading" } | { kind: "anonymous" } | { kind: "user"; user: SessionUser };

export function AccountPanel({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [linked, setLinked] = useState<LinkedAccountRow[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

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

  async function onSignOut(): Promise<void> {
    setLeaving(true);
    await signOut();
    window.location.assign(accountPageHref(locale, "login"));
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
        <dt className="font-semibold">{str(strings, "account.name")}</dt>
        <dd data-testid="account-name">{user.name}</dd>
        <dt className="font-semibold">{str(strings, "account.email")}</dt>
        <dd data-testid="account-email">
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

      <section aria-labelledby="linked-heading" className="flex flex-col gap-2">
        <h2 id="linked-heading" className="text-xl font-bold">
          {str(strings, "account.linked")}
        </h2>
        <p className="text-sm text-[var(--muted)]">{str(strings, "account.linkedHint")}</p>
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
      </section>

      <p>
        <button type="button" className="btn-secondary" disabled={leaving} onClick={() => void onSignOut()}>
          {leaving ? str(strings, "account.signingOut") : str(strings, "account.signOut")}
        </button>
      </p>
    </div>
  );
}
