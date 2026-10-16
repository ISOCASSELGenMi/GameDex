"use client";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { requestPasswordReset } from "./auth-api";
import { CONTROL_CLASS, Field, FormError } from "./form-parts";
import { accountPageHref } from "./links";
import { str } from "./str";
import { useHydrated } from "./use-hydrated";
import type { AccountStrings } from "./strings";

export function ForgotPasswordForm({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const uid = useId();
  const ready = useHydrated();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await requestPasswordReset(email.trim(), accountPageHref(locale, "reset-password"));
    setBusy(false);
    if (res.ok) setSent(true);
    else if (res.network) setError(str(strings, "common.network"));
    else if (res.status === 429) setError(str(strings, "common.rateLimited"));
    else setError(str(strings, "common.generic"));
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="notice">
          {str(strings, "forgot.sent")}
        </p>
        <p>
          <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "login")}>
            {str(strings, "forgot.backToLogin")}
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <FormError>{error}</FormError>
      <Field id={`${uid}-email`} label={str(strings, "common.email")}>
        {({ id, describedBy, invalid }) => (
          <input id={id} type="email" name="email" autoComplete="email" required className={CONTROL_CLASS} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <button type="submit" className="btn-primary" disabled={busy || !ready}>
        {busy ? str(strings, "forgot.submitting") : str(strings, "forgot.submit")}
      </button>
      <p>
        <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "login")}>
          {str(strings, "forgot.backToLogin")}
        </a>
      </p>
    </form>
  );
}
