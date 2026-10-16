/**
 * accounts 頁面內容（06：app/ 只放薄路由）。薄路由負責 PageShell、gateAccountsPage（404）與 metadata；
 * 這裡只產生 <article>。所有頁面 noindex、不進 sitemap，伺服器端內容與使用者無關（登入狀態由客戶端元件取得）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import type { AccountsPublicConfig } from "../domain/entities/public-config";
import { AccountListDetail } from "./account-list-detail";
import { AccountLists } from "./account-lists";
import { AccountPanel } from "./account-panel";
import { AccountPlays } from "./account-plays";
import { ForgotPasswordForm } from "./forgot-form";
import { LoginForm } from "./login-form";
import { accountPageHref, safeNextPath, type AccountPage } from "./links";
import { ResetPasswordForm } from "./reset-form";
import { SignupForm } from "./signup-form";
import { str } from "./str";
import { accountStrings } from "./strings";

const TITLE_KEY: Record<AccountPage, string> = {
  login: "login.title",
  signup: "signup.title",
  "forgot-password": "forgot.title",
  "reset-password": "reset.title",
  account: "account.title",
};

export function accountPageTitle(locale: Locale, page: AccountPage): string {
  return str(accountStrings(locale, [TITLE_KEY[page]]), TITLE_KEY[page]);
}

function Frame({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactElement {
  return (
    <article className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      <h1 className="text-3xl font-bold">{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </article>
  );
}

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] : v) ?? null;

export function LoginPage({ locale, config, searchParams }: { locale: Locale; config: AccountsPublicConfig; searchParams: Record<string, string | string[] | undefined> }): ReactElement {
  const s = accountStrings(locale);
  const next = safeNextPath(first(searchParams.next), `/${locale}/calendar`);
  return (
    <Frame title={str(s, "login.title")} description={str(s, "login.description")}>
      <LoginForm
        strings={s}
        locale={locale}
        next={next}
        socialProviders={config.socialProviders}
        signupHref={config.signupEnabled ? accountPageHref(locale, "signup") : null}
        initialError={first(searchParams.error)}
      />
    </Frame>
  );
}

export function SignupPage({ locale, config, searchParams }: { locale: Locale; config: AccountsPublicConfig; searchParams: Record<string, string | string[] | undefined> }): ReactElement {
  const s = accountStrings(locale);
  const next = safeNextPath(first(searchParams.next), `/${locale}/calendar`);
  return (
    <Frame title={str(s, "signup.title")} description={str(s, "signup.description")}>
      <SignupForm strings={s} locale={locale} next={next} socialProviders={config.socialProviders} />
    </Frame>
  );
}

export function ForgotPasswordPage({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale);
  return (
    <Frame title={str(s, "forgot.title")} description={str(s, "forgot.description")}>
      <ForgotPasswordForm strings={s} locale={locale} />
    </Frame>
  );
}

export function ResetPasswordPage({ locale, searchParams }: { locale: Locale; searchParams: Record<string, string | string[] | undefined> }): ReactElement {
  const s = accountStrings(locale);
  return (
    <Frame title={str(s, "reset.title")}>
      <ResetPasswordForm strings={s} locale={locale} token={first(searchParams.token)} hasError={!!first(searchParams.error)} />
    </Frame>
  );
}

export function AccountPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale);
  return (
    <Frame title={str(s, "account.title")}>
      <AccountPanel strings={s} locale={locale} />
    </Frame>
  );
}

// ── 第 5 波：帳號子頁（清單、清單內容、遊玩紀錄）。需登入：由客戶端的 RequireUser 判斷，伺服器端 HTML 與使用者無關 ──
export type AccountSubPage = "lists" | "list" | "plays";
const SUB_TITLE_KEY: Record<AccountSubPage, string> = { lists: "list.pageTitle", list: "list.detailTitle", plays: "play.pageTitle" };

export function accountSubPageTitle(locale: Locale, page: AccountSubPage): string {
  return str(accountStrings(locale, [SUB_TITLE_KEY[page]]), SUB_TITLE_KEY[page]);
}

function WideFrame({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <article className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 py-4">
      <h1 className="text-3xl font-bold">{title}</h1>
      {children}
    </article>
  );
}

const SUB_STRING_PREFIXES = ["list.", "play.", "error.", "common.", "account.signed", "account.signIn", "account.error."] as const;

export function AccountListsPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <WideFrame title={str(s, "list.pageTitle")}>
      <AccountLists strings={s} locale={locale} />
    </WideFrame>
  );
}

export function AccountListDetailPageView({ locale, listId }: { locale: Locale; listId: number }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <WideFrame title={str(s, "list.detailTitle")}>
      <AccountListDetail strings={s} locale={locale} listId={listId} />
    </WideFrame>
  );
}

export function AccountPlaysPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <WideFrame title={str(s, "play.pageTitle")}>
      <AccountPlays strings={s} locale={locale} />
    </WideFrame>
  );
}
