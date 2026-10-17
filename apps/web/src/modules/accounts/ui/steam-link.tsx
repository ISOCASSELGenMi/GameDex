"use client";
/** 「綁定 Steam」按鈕（帳號總覽與 Steam 遊戲庫分頁共用）：呼叫 Steam 登入流程，成功後整頁導向 Steam，失敗時用 onError 回報。 */
import { useState, type ReactElement } from "react";
import { signInSteam } from "./auth-api";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function LinkSteamButton({ strings, returnTo, onError }: { strings: AccountStrings; returnTo: string; onError: (text: string) => void }): ReactElement {
  const [linking, setLinking] = useState(false);
  async function onLink(): Promise<void> {
    setLinking(true);
    const res = await signInSteam(returnTo, returnTo);
    if (res.ok && res.data?.url) {
      window.location.assign(res.data.url);
      return;
    }
    setLinking(false);
    onError(res.network ? str(strings, "common.network") : res.status === 429 ? str(strings, "common.rateLimited") : str(strings, "login.error.steamInvalid"));
  }
  return (
    <button type="button" className="btn-secondary" disabled={linking} onClick={() => void onLink()}>
      {str(strings, "account.linkSteam")}
    </button>
  );
}
