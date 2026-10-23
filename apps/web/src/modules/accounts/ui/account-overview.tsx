"use client";
/** `/[locale]/account`（總覽分頁）：已綁定的登入方式（解除綁定、綁定 Steam）。個人摘要與登出在帳號頁殼（account-shell.tsx）。 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AccountCollection } from "./account-collection";
import { isExternalProvider } from "../domain/entities/providers";
import { listAccounts, unlinkAccount, type LinkedAccountRow } from "./auth-api";
import { useAccountSession } from "./account-session";
import { oauthErrorText } from "./oauth-error";
import { accountPageHref } from "./links";
import { LinkSteamButton } from "./steam-link";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { useSearchParam } from "./use-search-param";

export function AccountOverview({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement | null {
  const session = useAccountSession();
  const [linked, setLinked] = useState<LinkedAccountRow[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Steam／OAuth 綁定失敗會帶 ?error= 回來（在客戶端讀，伺服器端 HTML 與使用者、網址無關）
  const returnedError = useSearchParam("error");
  const active = session?.kind === "user" && !session.suspended;

  const loadLinked = useCallback(async () => {
    const res = await listAccounts();
    if (res.ok && Array.isArray(res.data)) setLinked(res.data.filter((a) => isExternalProvider(a.providerId)));
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void listAccounts().then((res) => {
      if (alive && res.ok && Array.isArray(res.data)) setLinked(res.data.filter((a) => isExternalProvider(a.providerId)));
    });
    return () => {
      alive = false;
    };
  }, [active]);

  // 未登入：殼已顯示登入提示與（如有）OAuth 錯誤；停權：殼已顯示說明
  if (!active) return null;
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

  return (
    <div className="flex flex-col gap-6">
      <AccountCollection strings={strings} />
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
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={str(strings, "account.unlinkAria", { provider: str(strings, `providers.${row.providerId}`) })}
                  onClick={() => void onUnlink(row)}
                >
                  {str(strings, "account.unlink")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!steamLinked ? (
          <p>
            <LinkSteamButton strings={strings} returnTo={accountPageHref(locale, "account")} onError={(text) => setMessage({ tone: "error", text })} />
          </p>
        ) : null}
      </section>
    </div>
  );
}
