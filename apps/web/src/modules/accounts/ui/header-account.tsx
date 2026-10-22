"use client";
/**
 * header.right 的客戶端元件（02 §UI slot、06 §SEO 與快取）：伺服器端 HTML 與使用者無關（可被 CDN 快取、不送 Set-Cookie），
 * 掛載後才向 `/api/v1/auth/get-session` 詢問登入狀態。外殼是共用的下拉（kernel/ui/dropdown，與導覽、主題、語言同一個）。
 * - 載入中：預留一個圖示按鈕大小的空位，避免版面跳動。
 * - 404（這個部署沒有啟用 accounts）：整個元件消失。
 * - 未登入：帳號圖示按鈕，選單內是「登入」「註冊」。
 * - 登入後：選單內是帳號頁各分頁的入口與登出。
 */
import { useEffect, useState, type ReactElement } from "react";
import { Dropdown } from "@/kernel/ui/dropdown";
import { UserIcon } from "@/kernel/ui/header-icons";
import { getPublicConfig, getSession, signOut, type SessionUser } from "./auth-api";
import { ACCOUNT_TABS, accountPageHref, accountTabHref } from "./links";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type State = { kind: "loading" } | { kind: "disabled" } | { kind: "anonymous"; signupEnabled: boolean } | { kind: "user"; user: SessionUser };

export function HeaderAccount({ locale, strings }: { locale: string; strings: AccountStrings }): ReactElement | null {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSession().then((res) => {
      if (!alive) return;
      if (res.status === 404) setState({ kind: "disabled" });
      else if (res.ok && res.data?.user) setState({ kind: "user", user: res.data.user });
      else {
        // 未登入：再問是否開放註冊（關閉時選單不出現「註冊」）；失敗就當作沒開放
        void getPublicConfig().then((cfg) => {
          if (alive) setState({ kind: "anonymous", signupEnabled: cfg.ok && cfg.data?.signupEnabled === true });
        });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "disabled") return null;
  if (state.kind === "loading") return <div className="dd-slot" aria-hidden="true" data-account-slot="loading" />;
  if (state.kind === "anonymous") {
    return (
      <div className="dd-slot-live" data-account-slot="anonymous">
        <Dropdown name="account" label={str(strings, "header.accountLabel")} icon={<UserIcon />} align="end">
          <ul className="dd-list">
            <li>
              <a className="dd-item" href={accountPageHref(locale, "login")}>
                {str(strings, "header.signIn")}
              </a>
            </li>
            {state.signupEnabled ? (
              <li>
                <a className="dd-item" href={accountPageHref(locale, "signup")}>
                  {str(strings, "header.signUp")}
                </a>
              </li>
            ) : null}
          </ul>
        </Dropdown>
      </div>
    );
  }

  const user = state.user;
  async function onSignOut(): Promise<void> {
    setLeaving(true);
    await signOut();
    window.location.reload();
  }

  return (
    <div className="dd-slot-live" data-account-slot="user">
      <Dropdown name="account" label={str(strings, "header.menu", { name: user.name })} icon={<UserIcon />} align="end">
        <ul className="dd-list">
          {ACCOUNT_TABS.map((tab) => (
            <li key={tab}>
              <a className="dd-item" href={accountTabHref(locale, tab)}>
                {str(strings, `account.tab.${tab}`)}
              </a>
            </li>
          ))}
          <li className="dd-sep" role="presentation" />
          <li>
            <button type="button" className="dd-item" disabled={leaving} onClick={() => void onSignOut()}>
              {leaving ? str(strings, "header.signingOut") : str(strings, "header.signOut")}
            </button>
          </li>
        </ul>
      </Dropdown>
    </div>
  );
}
