/**
 * header 導覽下拉的項目（單一陣列，要加項目就加一列；Z2 會加「全遊戲列表」「評分排名」）。
 * `exact`＝只有路徑完全相同才算目前頁（/games 不含遊戲詳情 /games/{slug}、首頁 / 不含其他頁）。
 */
import type { Locale, Translator } from "@sok/i18n";
import { eventsHref, gamesBrowseHref, localeHref, platformsHref } from "../links";

export interface NavItem {
  /** 去掉語系前綴的路徑，判斷目前頁用。 */
  path: string;
  href: string;
  label: string;
  exact: boolean;
}

export function navItems(locale: Locale, t: Translator): NavItem[] {
  return [
    { path: "/", href: localeHref(locale, "/"), label: t.t("ui.nav.home"), exact: true },
    { path: "/calendar", href: localeHref(locale, "/calendar"), label: t.t("ui.nav.calendar"), exact: false },
    { path: "/timeline", href: localeHref(locale, "/timeline"), label: t.t("ui.nav.timeline"), exact: false },
    { path: "/trending", href: localeHref(locale, "/trending"), label: t.t("ui.nav.trending"), exact: false },
    { path: "/games", href: gamesBrowseHref(locale), label: t.t("ui.nav.games"), exact: true },
    { path: "/platforms", href: platformsHref(locale), label: t.t("ui.nav.platforms"), exact: false },
    { path: "/events", href: eventsHref(locale), label: t.t("ui.nav.events"), exact: false },
  ];
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
