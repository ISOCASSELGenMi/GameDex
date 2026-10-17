// @module accounts
// 帳號頁殼（GameDex 第 2 段）：header／main（PageShell）＋個人摘要與分頁列（AccountShellView）。
// 所有帳號分頁（總覽、清單、遊玩紀錄、追蹤、我的遊戲、行事曆、Steam、設定、隱私）共用這個版面，切換分頁時殼不會重新載入。
// 刪除完成頁 /account/deleted 不需登入，在殼之外（上一層的 deleted/）。
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { PageShell } from "@/modules/catalog/ui";
import { AccountShellView, gateAccountsPage } from "@/modules/accounts/ui";

export default async function AccountShellLayout({ children, params }: LayoutProps<"/[locale]/account">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/account" followPathname>
      <AccountShellView locale={locale}>{children}</AccountShellView>
    </PageShell>
  );
}
