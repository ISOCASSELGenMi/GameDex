/**
 * accounts 頁面內容（06：app/ 只放薄路由）。薄路由負責 PageShell、gateAccountsPage（404）與 metadata；
 * 這裡只產生 <article>。所有頁面 noindex、不進 sitemap，伺服器端內容與使用者無關（登入狀態由客戶端元件取得）。
 */
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import type { AccountsPublicConfig } from "../domain/entities/public-config";
import { AccountCalendar, type GenreChoice, type PlatformGroup } from "./account-calendar";
import { AccountFollows } from "./account-follows";
import { AccountListDetail } from "./account-list-detail";
import { AccountLists } from "./account-lists";
import { AccountMyGames } from "./account-my-games";
import { AccountOverview } from "./account-overview";
import { AccountPrivacy } from "./account-privacy";
import { AccountSettings, type RegionOption } from "./account-settings";
import { AccountShell } from "./account-shell";
import { AccountSteamTab } from "./account-steam-tab";
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

/** 帳號頁殼（GameDex 第 2 段）：account/(shell)/layout.tsx 用；摘要、分頁列與登入狀態。 */
const SHELL_STRING_PREFIXES = ["account.", "common.", "login.error.", "suspended."] as const;
export function AccountShellView({ locale, children }: { locale: Locale; children: ReactNode }): ReactElement {
  return (
    <AccountShell strings={accountStrings(locale, SHELL_STRING_PREFIXES)} locale={locale}>
      {children}
    </AccountShell>
  );
}

/** `/account`（總覽分頁）：已綁定的登入方式。 */
export function AccountPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, ["account.", "common.", "login.error.", "providers.", "collection."]);
  return (
    <TabFrame title={str(s, "account.title")}>
      <AccountOverview strings={s} locale={locale} />
    </TabFrame>
  );
}

/** `/account/steam`（Steam 遊戲庫分頁）。 */
export function AccountSteamPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, ["steam.", "common.", "account.linkSteam", "login.error."]);
  return <AccountSteamTab strings={s} locale={locale} />;
}

// ── 第 5 波：帳號子頁（清單、清單內容、遊玩紀錄）。需登入：由客戶端的 RequireUser 判斷，伺服器端 HTML 與使用者無關 ──
export type AccountSubPage = "lists" | "list" | "plays" | "follows" | "games" | "calendar" | "steam" | "settings" | "privacy" | "deleted";
const SUB_TITLE_KEY: Record<AccountSubPage, string> = {
  lists: "list.pageTitle",
  list: "list.detailTitle",
  plays: "play.pageTitle",
  follows: "follows.title",
  games: "mygames.title",
  calendar: "feedcal.title",
  steam: "steam.title",
  settings: "settings.title",
  privacy: "privacy.title",
  deleted: "privacy.deleted.title",
};

export function accountSubPageTitle(locale: Locale, page: AccountSubPage): string {
  return str(accountStrings(locale, [SUB_TITLE_KEY[page]]), SUB_TITLE_KEY[page]);
}

/** 帳號分頁內容的外框：分頁標題是這一頁的 h1（與 <title> 一致；殼本身沒有標題）。 */
function TabFrame({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </section>
  );
}

/** 獨立頁（不在帳號頁殼底下，例如刪除完成頁）的外框。 */
function WideFrame({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <article className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 py-4">
      <h1 className="text-3xl font-bold">{title}</h1>
      {children}
    </article>
  );
}

const SUB_STRING_PREFIXES = ["list.", "play.", "error.", "common.", "account.signed", "account.signIn", "account.error.", "account.track.", "follows.", "mygames.", "feedcal.", "settings.", "privacy."] as const;

export function AccountListsPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "list.pageTitle")}>
      <AccountLists strings={s} locale={locale} />
    </TabFrame>
  );
}

export function AccountListDetailPageView({ locale, listId }: { locale: Locale; listId: number }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "list.detailTitle")}>
      <AccountListDetail strings={s} locale={locale} listId={listId} />
    </TabFrame>
  );
}

export function AccountPlaysPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "play.pageTitle")}>
      <AccountPlays strings={s} locale={locale} />
    </TabFrame>
  );
}

// ── 第 6 波：我的追蹤、我的遊戲、私人行事曆 ──
export function AccountFollowsPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "follows.title")}>
      <AccountFollows strings={s} locale={locale} />
    </TabFrame>
  );
}

export function AccountMyGamesPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "mygames.title")}>
      <AccountMyGames strings={s} locale={locale} />
    </TabFrame>
  );
}

/** `children`＝各日曆 App 的訂閱步驟（catalog 的訂閱頁說明元件，由薄路由傳入，避免複製第二份文案）。 */
export function AccountCalendarPageView({
  locale,
  platformGroups,
  genreChoices,
  children,
}: {
  locale: Locale;
  platformGroups: PlatformGroup[];
  genreChoices: GenreChoice[];
  children?: ReactNode;
}): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "feedcal.title")}>
      <AccountCalendar strings={s} locale={locale} platformGroups={platformGroups} genreChoices={genreChoices} />
      {children}
    </TabFrame>
  );
}

// ── 第 7 波：設定、隱私與資料、刪除完成 ──
export function AccountSettingsPageView({ locale, platformGroups, regions, scoreProviders }: { locale: Locale; platformGroups: PlatformGroup[]; regions: RegionOption[]; scoreProviders: string[] }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "settings.title")}>
      <AccountSettings strings={s} locale={locale} platformGroups={platformGroups} regions={regions} scoreProviders={scoreProviders} />
    </TabFrame>
  );
}

export function AccountPrivacyPageView({ locale }: { locale: Locale }): ReactElement {
  const s = accountStrings(locale, SUB_STRING_PREFIXES);
  return (
    <TabFrame title={str(s, "privacy.title")}>
      <AccountPrivacy strings={s} locale={locale} />
    </TabFrame>
  );
}

/** 刪除帳號後的完成頁（不需登入；伺服器 HTML 與使用者無關）。 */
export function AccountDeletedPageView({ locale, homeHref }: { locale: Locale; homeHref: string }): ReactElement {
  const s = accountStrings(locale, ["privacy.deleted."]);
  return (
    <WideFrame title={str(s, "privacy.deleted.title")}>
      <p role="status" data-testid="account-deleted">
        {str(s, "privacy.deleted.body")}
      </p>
      <p>
        <a className="btn-primary" href={homeHref}>
          {str(s, "privacy.deleted.home")}
        </a>
      </p>
    </WideFrame>
  );
}
