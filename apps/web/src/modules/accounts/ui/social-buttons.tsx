"use client";
/** 社群登入按鈕：只列出已設定憑證的 provider（由伺服器傳入）。點下去向 Better Auth 取得授權網址再導向。 */
import { useState, type ReactElement } from "react";
import { signInSocial } from "./auth-api";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function SocialButtons({
  strings,
  providers,
  callbackPath,
  errorPath,
  onError,
}: {
  strings: AccountStrings;
  providers: readonly string[];
  callbackPath: string;
  errorPath: string;
  onError: (message: string) => void;
}): ReactElement | null {
  const [busy, setBusy] = useState<string | null>(null);
  if (providers.length === 0) return null;

  async function go(provider: string): Promise<void> {
    setBusy(provider);
    const res = await signInSocial(provider, callbackPath, errorPath);
    if (res.ok && res.data?.url) {
      window.location.assign(res.data.url);
      return;
    }
    setBusy(null);
    onError(res.network ? str(strings, "common.network") : res.status === 429 ? str(strings, "common.rateLimited") : str(strings, "login.error.oauthFailed"));
  }

  return (
    <section aria-labelledby="social-heading" className="flex flex-col gap-2">
      <h2 id="social-heading" className="text-sm text-[var(--muted)]">
        {str(strings, "common.orSocial")}
      </h2>
      <ul className="flex flex-col gap-2">
        {providers.map((p) => (
          <li key={p}>
            <button type="button" className="btn-secondary w-full" disabled={busy !== null} onClick={() => void go(p)}>
              {str(strings, "common.continueWith", { provider: str(strings, `providers.${p}`) })}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
