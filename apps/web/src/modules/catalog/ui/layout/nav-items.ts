/**
 * header 導覽下拉的項目（單一陣列，要加項目就加一列）與 Holodex 式的品牌文字。
 * `exact`＝只有路徑完全相同才算目前頁（/games 不含遊戲詳情 /games/{slug}、首頁 / 不含其他頁）。
 * `brand`＝這個區塊的品牌名（header 左側的文字依目前頁面所屬區塊切換；品牌名不翻譯，三語相同）。
 */
import type { Locale, Translator } from "@sok/i18n";
import { eventsHref, gamesBrowseHref, localeHref, platformsHref } from "../links";

export interface NavItem {
  /** 去掉語系前綴的路徑，判斷目前頁用。 */
  path: string;
  href: string;
  label: string;
  /** 區塊品牌名（導覽項目的小字，也是 header 左側的文字）。 */
  brand: string;
  exact: boolean;
}

/** 站名品牌（首頁、帳號頁、關於頁等沒有自己區塊的頁面）。 */
export const DEFAULT_BRAND = "GameDex";

/** 各區塊的品牌名（第一段路徑 → 品牌）。順序＝導覽下拉的順序。 */
export const SECTION_BRANDS = [
  { path: "/", brand: "GameDex" },
  { path: "/calendar", brand: "GameCalendar" },
  { path: "/timeline", brand: "GameTimeline" },
  { path: "/trending", brand: "GameTrend" },
  { path: "/games", brand: "GameBase" },
  { path: "/platforms", brand: "GamePlat" },
  { path: "/events", brand: "GameEvent" },
  { path: "/ratings", brand: "GameRanking" },
] as const;

/** 子頁面跟隨所屬區塊：公司頁、系列頁是遊戲資料的一部分，歸遊戲區塊。 */
const SECTION_ALIASES: Readonly<Record<string, string>> = { "/companies": "/games", "/franchises": "/games" };

/** 目前頁（去掉語系前綴的路徑）所屬區塊的品牌名；不屬於任何區塊（帳號、關於、訂閱…）用站名。 */
export function brandOfPath(path: string): string {
  const first = `/${path.split("/")[1] ?? ""}`;
  const section = SECTION_ALIASES[first] ?? first;
  return SECTION_BRANDS.find((s) => s.path === section)?.brand ?? DEFAULT_BRAND;
}

export function navItems(locale: Locale, t: Translator): NavItem[] {
  const href: Record<string, string> = {
    "/": localeHref(locale, "/"),
    "/games": gamesBrowseHref(locale),
    "/platforms": platformsHref(locale),
    "/events": eventsHref(locale),
  };
  const label: Record<string, string> = {
    "/": t.t("ui.nav.home"),
    "/calendar": t.t("ui.nav.calendar"),
    "/timeline": t.t("ui.nav.timeline"),
    "/trending": t.t("ui.nav.trending"),
    "/games": t.t("ui.nav.games"),
    "/platforms": t.t("ui.nav.platforms"),
    "/events": t.t("ui.nav.events"),
    "/ratings": t.t("ui.nav.ratings"),
  };
  return SECTION_BRANDS.map((s) => ({
    path: s.path,
    href: href[s.path] ?? localeHref(locale, s.path),
    label: label[s.path]!,
    brand: s.brand,
    exact: s.path === "/" || s.path === "/games",
  }));
}

/** 目前頁是否是這個項目（path 是去掉語系前綴的路徑）。 */
export function isCurrentNav(item: Pick<NavItem, "path" | "exact">, path: string): boolean {
  return path === item.path || (!item.exact && path.startsWith(`${item.path}/`));
}

/** `/en/calendar/2026-10` → `/calendar/2026-10`；`/en` → `/`。 */
export function stripLocalePrefix(pathname: string): string {
  const rest = pathname.replace(/^\/[^/]+/, "");
  return rest === "" ? "/" : rest;
}
