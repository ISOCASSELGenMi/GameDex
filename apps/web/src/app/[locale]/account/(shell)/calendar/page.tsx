// @module accounts
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { listPlatforms } from "@/modules/catalog";
import { SubscribeClientsSection, listGenreChoices, type GenreChoice } from "@/modules/catalog/ui";
import type { Locale } from "@sok/i18n";
import { AccountCalendarPageView, accountSubPageTitle, gateAccountsPage, type PlatformGroup } from "@/modules/accounts/ui";

export const instant = false;

// 帳號子頁不索引、不進 sitemap；內容與使用者無關（私人網址由客戶端在登入後才取得）
export async function generateMetadata({ params }: PageProps<"/[locale]/account/calendar">): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  return { title: accountSubPageTitle(locale, "calendar"), robots: { index: false, follow: false } };
}

/** 平台篩選的選項（只是設定表單用；讀取失敗就不提供平台篩選，其他設定照常）。 */
async function platformGroups(locale: string): Promise<PlatformGroup[]> {
  try {
    const groups = await listPlatforms({ locale });
    return groups.map((g) => ({ kind: g.kind, platforms: g.platforms.map((p) => ({ id: p.id, name: p.name })) }));
  } catch {
    return [];
  }
}

/** 類型篩選的選項（與月曆篩選面板同一份清單與翻譯；讀取失敗就不提供類型篩選）。 */
async function genreChoices(locale: Locale): Promise<GenreChoice[]> {
  try {
    return await listGenreChoices(locale);
  } catch {
    return [];
  }
}

export default async function AccountCalendar({ params }: PageProps<"/[locale]/account/calendar">) {
  const { locale } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  await gateAccountsPage();
  return (
    <AccountCalendarPageView locale={locale} platformGroups={await platformGroups(locale)} genreChoices={await genreChoices(locale)}>
      <SubscribeClientsSection locale={locale} />
    </AccountCalendarPageView>
  );
}
