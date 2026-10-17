"use client";
/**
 * 帳號頁殼（GameDex 第 2 段；參考 IGDB 個人頁）：上方個人摘要（頭像、名稱、清單數／遊玩紀錄數／追蹤數、登出），
 * 下方分頁列，分頁內容（children）是各子頁。由 app/[locale]/account/(shell)/layout.tsx 放在所有分頁共用的版面，
 * 所以切換分頁時殼不會重新載入（只換 children；登入狀態與摘要只取一次，各分頁的 RequireUser 讀這裡的狀態）。
 *
 * 分頁列用「連結式」分頁（<a aria-current="page">，next/link 做客戶端切換），不用 ARIA tablist：每個分頁都是自己的網址與頁面
 * （伺服器各自讀自己需要的資料），不是同一份文件內的 tabpanel；連結式分頁的鍵盤操作（Tab／Enter）、「在新分頁開啟」、
 * 直接分享網址都是原生行為，且不需要 roving tabindex 與方向鍵的自訂處理。
 * 停權帳號（D83）只顯示說明；分頁只剩「隱私與資料」（匯出、刪除）。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { isPlaceholderEmail } from "../domain/entities/email";
import { getAccountStatus, getAccountSummary } from "./account-self-api";
import { AccountSessionContext, type AccountSession } from "./account-session";
import { getSession, signOut } from "./auth-api";
import { ACCOUNT_TABS, accountPageHref, accountTabFromPath, accountTabHref, type AccountTab } from "./links";
import { oauthErrorText } from "./oauth-error";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { SuspendedNotice } from "./suspended-notice";
import { useSearchParam } from "./use-search-param";

interface Summary {
  lists: number;
  playRecords: number;
  follows: number;
}

function Avatar({ name, image }: { name: string; image?: string | null }): ReactElement {
  const safe = image && /^https:\/\//i.test(image) ? image : null;
  // 頭像網址來自社群登入服務（網域不固定），不經 next/image 最佳化器
  return safe ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt="" width={64} height={64} referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-full object-cover" data-account-avatar="image" />
  ) : (
    <span aria-hidden="true" data-account-avatar="initial" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[var(--surface-strong)] text-2xl font-bold">
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export function AccountShell({ strings, locale, children }: { strings: AccountStrings; locale: string; children: ReactNode }): ReactElement {
  const pathname = usePathname();
  const tab: AccountTab | null = accountTabFromPath(pathname);
  const [session, setSession] = useState<AccountSession>({ kind: "loading" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leaving, setLeaving] = useState(false);
  const returnedError = useSearchParam("error");
  const currentRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (!alive) return;
      if (res.ok && res.data?.user) {
        const status = await getAccountStatus();
        if (!alive) return;
        setSession({ kind: "user", user: res.data.user, suspended: status.ok && status.data?.suspended === true });
      } else setSession({ kind: "anonymous" });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const active = session.kind === "user" && !session.suspended;
  // 摘要數字在換分頁時重抓（剛在別的分頁新增清單、紀錄後回來要看到新數字）；舊數字保留到新數字回來，不閃爍
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void getAccountSummary().then((res) => {
      if (alive && res.ok && res.data) setSummary(res.data);
    });
    return () => {
      alive = false;
    };
  }, [active, tab]);

  // 目前分頁在窄螢幕的橫向捲動列裡要看得到：只捲分頁列自己（不用 scrollIntoView，避免連頁面一起捲）
  useEffect(() => {
    let alive = true;
    const center = () => {
      const el = currentRef.current;
      const scroller = el?.closest("ul");
      if (!alive || !el || !scroller) return;
      const a = el.getBoundingClientRect();
      const b = scroller.getBoundingClientRect();
      scroller.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
    };
    center();
    // 字型載入完成後各分頁的寬度會變（中文、日文字型較晚到），再校正一次
    void document.fonts?.ready.then(center);
    return () => {
      alive = false;
    };
  }, [tab, session.kind]);

  const onSignOut = useCallback(async () => {
    setLeaving(true);
    await signOut();
    window.location.assign(accountPageHref(locale, "login"));
  }, [locale]);

  const tabs: readonly AccountTab[] = session.kind === "user" && session.suspended ? ["privacy"] : ACCOUNT_TABS;
  const user = session.kind === "user" ? session.user : null;

  return (
    <AccountSessionContext.Provider value={session}>
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4 py-4" data-account-shell="">
        {session.kind === "loading" ? <p aria-live="polite">{str(strings, "common.loading")}</p> : null}

        {session.kind === "anonymous" ? (
          <div className="flex flex-col gap-3">
            {returnedError ? (
              <p role="alert" className="notice text-[var(--danger)]">
                {oauthErrorText(strings, returnedError)}
              </p>
            ) : null}
            <h1 className="text-2xl font-bold">{str(strings, "account.title")}</h1>
            <h2 className="text-xl font-bold">{str(strings, "account.signedOutTitle")}</h2>
            <p>{str(strings, "account.signedOutBody")}</p>
            <p>
              <a className="btn-primary" href={accountPageHref(locale, "login", `next=${encodeURIComponent(typeof window === "undefined" ? accountTabHref(locale, "overview") : `${window.location.pathname}${window.location.search}`)}`)}>
                {str(strings, "account.signIn")}
              </a>
            </p>
          </div>
        ) : null}

        {user ? (
          <section aria-label={str(strings, "account.summary.label")} className="flex flex-wrap items-center gap-x-6 gap-y-3" data-account-summary="">
            <Avatar name={user.name} image={user.image} />
            <div className="min-w-0 flex-[1_1_12rem]">
              <p data-testid="account-name" className="text-2xl font-bold [overflow-wrap:anywhere]">
                {user.name}
              </p>
              <p data-testid="account-email" className="text-sm text-[var(--muted)] [overflow-wrap:anywhere]">
                {isPlaceholderEmail(user.email) ? (
                  str(strings, "account.emailNone")
                ) : (
                  <>
                    {user.email}
                    {user.emailVerified ? "" : ` ${str(strings, "account.emailUnverified")}`}
                  </>
                )}
              </p>
            </div>
            {active ? (
              <dl className="flex gap-6" data-account-stats="">
                {(
                  [
                    ["lists", summary?.lists],
                    ["playRecords", summary?.playRecords],
                    ["follows", summary?.follows],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-sm text-[var(--muted)]">{str(strings, `account.stat.${key}`)}</dt>
                    <dd className="text-xl font-bold" data-stat={key}>
                      {value ?? "–"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <button type="button" className="btn-secondary" disabled={leaving} onClick={() => void onSignOut()}>
              {leaving ? str(strings, "account.signingOut") : str(strings, "account.signOut")}
            </button>
          </section>
        ) : null}

        {session.kind === "user" && session.suspended ? <SuspendedNotice strings={strings} locale={locale} showPrivacyLink={tab !== "privacy"} /> : null}

        {session.kind !== "anonymous" ? (
          <nav aria-label={str(strings, "account.tabs.label")} className="relative border-b border-[var(--border)]" data-account-tabs="">
            <ul className="relative flex list-none gap-1 overflow-x-auto p-0">
              {tabs.map((t) => (
                <li key={t} className="shrink-0">
                  <Link
                    href={accountTabHref(locale, t)}
                    ref={t === tab ? currentRef : undefined}
                    aria-current={t === tab ? "page" : undefined}
                    data-account-tab={t}
                    className="inline-flex min-h-11 items-center border-b-2 border-transparent px-3 whitespace-nowrap hover:bg-[var(--surface)] aria-[current=page]:border-[var(--link)] aria-[current=page]:font-bold"
                  >
                    {str(strings, `account.tab.${t}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {session.kind !== "anonymous" ? (
          <div className="min-w-0" data-account-panel={tab ?? ""}>
            {children}
          </div>
        ) : null}
      </div>
    </AccountSessionContext.Provider>
  );
}
