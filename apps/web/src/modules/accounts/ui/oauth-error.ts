import { str } from "./str";
import type { AccountStrings } from "./strings";

/** 登入頁與帳號頁共用：OAuth／Steam 回來時 `?error=` 的文案（Better Auth 與 Steam plugin 的錯誤碼）。 */
export function oauthErrorText(strings: AccountStrings, code: string | null): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c === "account_not_linked") return str(strings, "login.error.accountNotLinked");
  if (c === "email_not_found") return str(strings, "login.error.emailNotFound");
  if (c === "signup_disabled") return str(strings, "login.error.signupDisabled");
  if (c === "steam_invalid_response") return str(strings, "login.error.steamInvalid");
  if (c === "steam_verification_failed") return str(strings, "login.error.steamVerification");
  if (c === "steam_already_linked") return str(strings, "login.error.steamAlreadyLinked");
  if (c === "steam_network_error") return str(strings, "login.error.steamNetwork");
  return str(strings, "login.error.oauthFailed");
}
