"use client";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { signInEmail } from "./auth-api";
import { CONTROL_CLASS, Field, FormError } from "./form-parts";
import { accountPageHref } from "./links";
import { oauthErrorText } from "./oauth-error";
import { SocialButtons } from "./social-buttons";
import { str } from "./str";
import { useHydrated } from "./use-hydrated";
import type { AccountStrings } from "./strings";

export interface LoginFormProps {
  strings: AccountStrings;
  locale: string;
  /** 登入成功後前往的站內路徑（已由伺服器驗證為相對路徑）。 */
  next: string;
  socialProviders: readonly string[];
  /** 註冊開放時才有「建立帳號」連結（關閉時入口不出現）。 */
  signupHref: string | null;
  /** OAuth 錯誤回到登入頁時的 `?error=`（Better Auth 的錯誤碼）。 */
  initialError: string | null;
}

export function LoginForm({ strings, locale, next, socialProviders, signupHref, initialError }: LoginFormProps): ReactElement {
  const uid = useId();
  const ready = useHydrated();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthErrorText(strings, initialError));
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await signInEmail(email.trim(), password);
    if (res.ok) {
      window.location.assign(next);
      return;
    }
    setBusy(false);
    if (res.network) setError(str(strings, "common.network"));
    else if (res.status === 429) setError(str(strings, "common.rateLimited"));
    else if (res.status === 401 || res.status === 400 || res.status === 403) setError(str(strings, "login.error.invalid"));
    else setError(str(strings, "common.generic"));
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate={false}>
        <FormError>{error}</FormError>
        <Field id={`${uid}-email`} label={str(strings, "common.email")}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="email" name="email" autoComplete="username" required className={CONTROL_CLASS} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <Field id={`${uid}-password`} label={str(strings, "common.password")}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="password" name="password" autoComplete="current-password" required className={CONTROL_CLASS} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <button type="submit" className="btn-primary" disabled={busy || !ready}>
          {busy ? str(strings, "login.submitting") : str(strings, "login.submit")}
        </button>
        <p>
          <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "forgot-password")}>
            {str(strings, "login.forgot")}
          </a>
        </p>
      </form>
      <SocialButtons strings={strings} providers={socialProviders} callbackPath={next} errorPath={accountPageHref(locale, "login")} onError={setError} />
      {signupHref ? (
        <p>
          {str(strings, "login.noAccount")}{" "}
          <a className="link inline-flex min-h-11 items-center" href={signupHref}>
            {str(strings, "login.signupLink")}
          </a>
        </p>
      ) : null}
    </div>
  );
}
