"use client";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../domain/entities/password-policy";
import { resetPassword } from "./auth-api";
import { CONTROL_CLASS, Field, FormError } from "./form-parts";
import { accountPageHref } from "./links";
import { str } from "./str";
import { useHydrated } from "./use-hydrated";
import type { AccountStrings } from "./strings";

/** 重設連結的 token 由 Better Auth 的 callback 轉址帶到 `?token=`；無效則帶 `?error=INVALID_TOKEN`。 */
export function ResetPasswordForm({ strings, locale, token, hasError }: { strings: AccountStrings; locale: string; token: string | null; hasError: boolean }): ReactElement {
  const uid = useId();
  const ready = useHydrated();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(hasError || !token);
  const [busy, setBusy] = useState(false);

  if (invalid) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="notice text-[var(--danger)]">
          {str(strings, "reset.invalidToken")}
        </p>
        <p>
          <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "forgot-password")}>
            {str(strings, "reset.requestNew")}
          </a>
        </p>
      </div>
    );
  }
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="notice">
          {str(strings, "reset.success")}
        </p>
        <p>
          <a className="btn-primary" href={accountPageHref(locale, "login")}>
            {str(strings, "reset.goLogin")}
          </a>
        </p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy || !token) return;
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setFieldError(str(strings, password.length < MIN_PASSWORD_LENGTH ? "signup.error.passwordTooShort" : "signup.error.passwordTooLong"));
      return;
    }
    setFieldError(null);
    setBusy(true);
    const res = await resetPassword(token, password);
    setBusy(false);
    if (res.ok) setDone(true);
    else if (res.network) setError(str(strings, "common.network"));
    else if (res.status === 429) setError(str(strings, "common.rateLimited"));
    else if (res.code === "INVALID_TOKEN") setInvalid(true);
    else if (res.code === "PASSWORD_TOO_SHORT") setFieldError(str(strings, "signup.error.passwordTooShort"));
    else setError(str(strings, "common.generic"));
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <FormError>{error}</FormError>
      <Field id={`${uid}-password`} label={str(strings, "reset.newPassword")} hint={str(strings, "signup.passwordHint")} error={fieldError}>
        {({ id, describedBy, invalid: inv }) => (
          <input id={id} type="password" name="password" autoComplete="new-password" required className={CONTROL_CLASS} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={describedBy} aria-invalid={inv} />
        )}
      </Field>
      <button type="submit" className="btn-primary" disabled={busy || !ready}>
        {busy ? str(strings, "reset.submitting") : str(strings, "reset.submit")}
      </button>
    </form>
  );
}
