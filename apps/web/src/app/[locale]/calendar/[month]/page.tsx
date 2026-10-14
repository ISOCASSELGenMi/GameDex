// @module catalog
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import { CalendarMonthPage, calendarTitle, parseMonthParam, seoMetadata } from "@/modules/catalog/ui";

// 整頁在回應前算完（不串流），讓錯誤月份回真正的 404（見 C-report）
export const instant = false;

export async function generateMetadata({ params, searchParams }: PageProps<"/[locale]/calendar/[month]">): Promise<Metadata> {
  const { locale, month } = await params;
  const ym = parseMonthParam(month);
  if (!isSupportedLocale(locale) || !ym) return {};
  // 篩選變體指回無篩選的月份頁；多維組合 noindex
  const meta = { searchParams: await searchParams, queryRules: [], filterPage: true };
  return { title: calendarTitle(locale, ym), ...seoMetadata({ locale, config: getLocaleConfig(), path: `/calendar/${month}`, ...meta }) };
}

export default async function CalendarMonth({ params, searchParams }: PageProps<"/[locale]/calendar/[month]">) {
  const { locale, month } = await params;
  const config = getLocaleConfig();
  if (!isSupportedLocale(locale, config)) notFound();
  return <CalendarMonthPage locale={locale} supportedLocales={config.supported} month={month} searchParams={await searchParams} />;
}
