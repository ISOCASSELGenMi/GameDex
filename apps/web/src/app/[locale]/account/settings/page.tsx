// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createTranslator } from "@sok/i18n";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { KNOWN_RATING_PROVIDERS, listPlatforms, listRegions } from "@/modules/catalog";
import { PageShell } from "@/modules/catalog/ui";
import { AccountSettingsPageView, accountSubPageTitle, gateAccountsPage, type PlatformGroup } from "@/modules/accounts/ui";

export const instant = false;

// 帳號子頁不索引、不進 sitemap；內容與使用者無關（偏好由客戶端在登入後才取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/account/settings">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "settings"), robots: { index: false, follow: false } };
}

/** 常用平台的選項（讀取失敗就不提供平台設定，其他設定照常）。 */
async function platformGroups(locale: string): Promise<PlatformGroup[]> {
  try {
    const groups = await listPlatforms({ locale });
    return groups.map((g) => ({ kind: g.kind, platforms: g.platforms.map((p) => ({ id: p.id, name: p.name })) }));
  } catch {
    return [];
  }
}

/** 地區選項：字典有名稱用字典，否則用資料庫的名稱。 */
async function regionOptions(locale: Parameters<typeof createTranslator>[0]) {
  try {
    const t = createTranslator(locale);
    return (await listRegions()).map((r) => ({ code: r.code, name: t.has(`enums.region.${r.code}`) ? t.t(`enums.region.${r.code}`) : r.name }));
  } catch {
    return [];
  }
}

export default async function AccountSettings({ params }: PageProps<"/[locale]/account/settings">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <PageShell locale={locale} supportedLocales={config.supported} path="/account/settings">
      <AccountSettingsPageView locale={locale} platformGroups={await platformGroups(locale)} regions={await regionOptions(locale)} scoreProviders={[...KNOWN_RATING_PROVIDERS]} />
    </PageShell>
  );
}
