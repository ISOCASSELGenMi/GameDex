// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { SignupPage, accountPageTitle, gateAccountsPage } from "@/modules/accounts/ui";

export const instant = false;

// 帳號頁不索引、不進 sitemap；內容與使用者無關（登入狀態由客戶端元件取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountPageTitle(locale, "signup"), robots: { index: false, follow: false } };
}


export default async function Signup({ params, searchParams }: PageProps<"/[locale]/signup">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  // 註冊關閉：入口不存在（軟 404）
  const accounts = await gateAccountsPage({ requireSignup: true });
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/signup">
      <SignupPage locale={locale} config={accounts} searchParams={await searchParams} />
    </PageShell>
  );
}
