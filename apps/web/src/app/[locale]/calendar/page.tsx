// @module catalog
// /[locale]/calendar（無月份）→ 導到今天（UTC）所在月份，保留篩選 query。
// 導向而不是直接渲染：月份網址的內容固定，可長快取；本網址的導向會隨日期變動（3.5 短快取）。
import { notFound } from "next/navigation";
import { isSupportedLocale } from "@/kernel/locale";
import { redirectToCurrentMonth } from "@/modules/catalog/ui";

export const instant = false;

export default async function CalendarIndex({ params, searchParams }: PageProps<"/[locale]/calendar">) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return redirectToCurrentMonth(locale, await searchParams);
}
