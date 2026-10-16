"use client";
/**
 * `/[locale]/account/privacy`：隱私與資料（09 §隱私、匯出、刪除）。
 * - 資料匯出：JSON（全部）或 CSV（分段），以 fetch 下載，失敗時在頁面上說明（例如每小時次數上限）。
 * - 刪除帳號（危險區）：說明會刪掉什麼、不可復原；有密碼的帳號輸入密碼，沒有密碼的帳號需要「剛登入過」（10 分鐘內），
 *   否則引導重新登入；勾選「我了解」後再按一次確認才送出。成功後 session 已被伺服器清掉，導向刪除完成頁。
 */
import { useEffect, useId, useState, type ReactElement } from "react";
import { EXPORT_CSV_PARTS, REAUTH_WINDOW_SECONDS, type ExportCsvPart } from "../domain/entities/account-self";
import { deleteAccount, downloadExport, type ExportRequest } from "./account-self-api";
import { listAccounts, signOut } from "./auth-api";
import { ConfirmButton } from "./confirm-button";
import { CONTROL_CLASS, Field } from "./form-parts";
import { accountDeletedHref, accountPageHref, accountPrivacyHref, accountSettingsHref } from "./links";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function AccountPrivacy({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <div className="flex min-w-0 flex-col gap-8">
        <ExportSection strings={strings} />
        <DeleteSection strings={strings} locale={locale} />
        <p className="flex flex-wrap gap-x-6">
          <a className="link inline-flex min-h-11 items-center" href={`/${locale}/about/privacy`}>
            {str(strings, "privacy.policyLink")}
          </a>
          <a className="link inline-flex min-h-11 items-center" href={accountSettingsHref(locale)}>
            {str(strings, "privacy.toSettings")}
          </a>
          <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "account")}>
            {str(strings, "settings.toAccount")}
          </a>
        </p>
      </div>
    </RequireUser>
  );
}

type Notice = { tone: "ok" | "error"; text: string } | null;

function ExportSection({ strings }: { strings: AccountStrings }): ReactElement {
  const uid = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function run(key: string, req: ExportRequest): Promise<void> {
    setBusy(key);
    setNotice(null);
    const res = await downloadExport(req);
    setBusy(null);
    if (res.ok) setNotice({ tone: "ok", text: str(strings, "privacy.export.done", { file: res.filename }) });
    else if (res.network) setNotice({ tone: "error", text: str(strings, "common.network") });
    else if (res.status === 429) setNotice({ tone: "error", text: str(strings, "privacy.export.rateLimited") });
    else if (res.status === 401) setNotice({ tone: "error", text: str(strings, "error.unauthorized") });
    else setNotice({ tone: "error", text: str(strings, "privacy.export.failed") });
  }

  return (
    <section aria-labelledby={`${uid}-title`} className="flex min-w-0 flex-col gap-3" data-section="export">
      <h2 id={`${uid}-title`} className="text-xl font-bold">
        {str(strings, "privacy.export.title")}
      </h2>
      <p>{str(strings, "privacy.export.intro")}</p>
      <ul className="list-disc space-y-1 pl-6">
        {["profile", "connections", "lists", "plays", "follows", "owned", "calendar"].map((k) => (
          <li key={k}>{str(strings, `privacy.export.includes.${k}`)}</li>
        ))}
      </ul>
      <p className="text-sm text-[var(--muted)]">{str(strings, "privacy.export.excludes")}</p>
      <p>
        <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void run("json", { format: "json" })} data-export="json">
          {str(strings, "privacy.export.json")}
        </button>
      </p>
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{str(strings, "privacy.export.csvTitle")}</h3>
        <p className="text-sm text-[var(--muted)]">{str(strings, "privacy.export.csvHint")}</p>
        <ul className="flex flex-wrap gap-2">
          {EXPORT_CSV_PARTS.map((part: ExportCsvPart) => (
            <li key={part}>
              <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void run(part, { format: "csv", part })} data-export={`csv-${part}`}>
                {str(strings, `privacy.export.part.${part}`)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {busy ? <p>{str(strings, "privacy.export.preparing")}</p> : notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
    </section>
  );
}

function DeleteSection({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const uid = useId();
  // 是否有密碼：Better Auth 的 list-accounts 含 credential 列
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await listAccounts();
      if (alive) setHasPassword(res.ok && Array.isArray(res.data) ? res.data.some((a) => a.providerId === "credential") : null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function reauth(): Promise<void> {
    setLeaving(true);
    await signOut();
    window.location.assign(accountPageHref(locale, "login", `next=${encodeURIComponent(accountPrivacyHref(locale))}`));
  }

  async function onDelete(): Promise<void> {
    setNotice(null);
    setPasswordError(null);
    setNeedsReauth(false);
    if (hasPassword && password === "") {
      setPasswordError(str(strings, "privacy.delete.passwordRequired"));
      return;
    }
    const res = await deleteAccount(hasPassword ? password : null);
    if (res.ok) {
      window.location.assign(accountDeletedHref(locale));
      return;
    }
    if (res.code === "invalid_password") setPasswordError(str(strings, "privacy.delete.wrongPassword"));
    else if (res.code === "reauth_required") setNeedsReauth(true);
    else if (res.fields?.password) setPasswordError(str(strings, "privacy.delete.passwordRequired"));
    else if (res.status === 429) setNotice({ tone: "error", text: str(strings, "privacy.delete.rateLimited") });
    else if (res.status === 401) setNotice({ tone: "error", text: str(strings, "error.unauthorized") });
    else setNotice({ tone: "error", text: res.network ? str(strings, "common.network") : str(strings, "common.generic") });
  }

  const minutes = String(REAUTH_WINDOW_SECONDS / 60);
  return (
    <section aria-labelledby={`${uid}-title`} className="flex min-w-0 flex-col gap-3 rounded-xl border-2 border-[var(--danger)] p-4" data-section="danger-zone">
      <h2 id={`${uid}-title`} className="text-xl font-bold text-[var(--danger)]">
        {str(strings, "privacy.delete.title")}
      </h2>
      <p>{str(strings, "privacy.delete.intro")}</p>
      <ul className="list-disc space-y-1 pl-6">
        {["account", "lists", "plays", "follows", "owned", "calendar"].map((k) => (
          <li key={k}>{str(strings, `privacy.delete.removes.${k}`)}</li>
        ))}
      </ul>
      <p className="font-semibold">{str(strings, "privacy.delete.irreversible")}</p>
      <p className="text-sm text-[var(--muted)]">{str(strings, "privacy.delete.backups")}</p>

      {hasPassword === false ? (
        <div className="flex flex-col gap-2" data-testid="delete-reauth">
          <p>{str(strings, "privacy.delete.noPassword", { minutes })}</p>
          <p>
            <button type="button" className="btn-secondary" disabled={leaving} onClick={() => void reauth()}>
              {str(strings, "privacy.delete.reauthButton")}
            </button>
          </p>
        </div>
      ) : null}
      {hasPassword ? (
        <Field id={`${uid}-pw`} label={str(strings, "privacy.delete.password")} hint={str(strings, "privacy.delete.passwordHint")} error={passwordError}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="password" autoComplete="current-password" className={CONTROL_CLASS} value={password} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
      ) : null}
      {needsReauth ? (
        <div role="alert" className="notice flex flex-col gap-2">
          <p>{str(strings, "privacy.delete.reauthNeeded", { minutes })}</p>
          <p>
            <button type="button" className="btn-secondary" disabled={leaving} onClick={() => void reauth()}>
              {str(strings, "privacy.delete.reauthButton")}
            </button>
          </p>
        </div>
      ) : null}

      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{str(strings, "privacy.delete.ack")}</span>
      </label>
      <div>
        <ConfirmButton
          strings={strings}
          label={str(strings, "privacy.delete.button")}
          confirmText={str(strings, "privacy.delete.confirm")}
          confirmLabel={str(strings, "privacy.delete.confirmButton")}
          disabled={!ack || hasPassword === null}
          onConfirm={onDelete}
        />
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className="text-[var(--danger)]">{notice.text}</p> : null}
      </div>
    </section>
  );
}
