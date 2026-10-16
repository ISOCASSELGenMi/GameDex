"use client";
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../domain/entities/password-policy";
import { signUpEmail } from "./auth-api";
import { CONTROL_CLASS, Field, FormError } from "./form-parts";
import { accountPageHref } from "./links";
import { SocialButtons } from "./social-buttons";
import { str } from "./str";
import { useHydrated } from "./use-hydrated";
import type { AccountStrings } from "./strings";

export function SignupForm({
  strings,
  locale,
  next,
  socialProviders,
}: {
  strings: AccountStrings;
  locale: string;
  next: string;
  socialProviders: readonly string[];
}): ReactElement {
  const uid = useId();
  const ready = useHydrated();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const errors: Record<string, string> = {};
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = str(strings, "signup.error.passwordTooShort");
    if (password.length > MAX_PASSWORD_LENGTH) errors.password = str(strings, "signup.error.passwordTooLong");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    const res = await signUpEmail(name.trim(), email.trim(), password);
    if (res.ok) {
      window.location.assign(next);
      return;
    }
    setBusy(false);
    if (res.network) setError(str(strings, "common.network"));
    else if (res.status === 429) setError(str(strings, "common.rateLimited"));
    else if (res.status === 404) setError(str(strings, "signup.error.closed"));
    else if (res.code === "USER_ALREADY_EXISTS" || res.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") setFieldErrors({ email: str(strings, "signup.error.emailTaken") });
    else if (res.code === "PASSWORD_TOO_SHORT") setFieldErrors({ password: str(strings, "signup.error.passwordTooShort") });
    else if (res.code === "PASSWORD_TOO_LONG") setFieldErrors({ password: str(strings, "signup.error.passwordTooLong") });
    else if (res.code === "NAME_TOO_LONG") setFieldErrors({ name: str(strings, "signup.error.nameTooLong") });
    else if (res.code === "INVALID_EMAIL" || res.code === "EMAIL_TOO_LONG") setFieldErrors({ email: str(strings, "signup.error.emailInvalid") });
    else setError(str(strings, "common.generic"));
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <Field id={`${uid}-name`} label={str(strings, "common.displayName")} error={fieldErrors.name}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="text" name="name" autoComplete="nickname" required maxLength={100} className={CONTROL_CLASS} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <Field id={`${uid}-email`} label={str(strings, "common.email")} error={fieldErrors.email}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="email" name="email" autoComplete="email" required className={CONTROL_CLASS} value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <Field id={`${uid}-password`} label={str(strings, "common.password")} hint={str(strings, "signup.passwordHint")} error={fieldErrors.password}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="password" name="password" autoComplete="new-password" required className={CONTROL_CLASS} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <button type="submit" className="btn-primary" disabled={busy || !ready}>
          {busy ? str(strings, "signup.submitting") : str(strings, "signup.submit")}
        </button>
      </form>
      <SocialButtons strings={strings} providers={socialProviders} callbackPath={next} errorPath={accountPageHref(locale, "login")} onError={setError} />
      <p>
        {str(strings, "signup.haveAccount")}{" "}
        <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "login")}>
          {str(strings, "signup.loginLink")}
        </a>
      </p>
    </div>
  );
}
