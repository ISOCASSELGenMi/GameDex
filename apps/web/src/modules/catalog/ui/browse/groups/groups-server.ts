/**
 * 瀏覽頁分組檢視的資料載入（伺服器端）：頁面與 route handler 共用，只有這裡呼叫 Use Case 並轉成畫面資料。
 * 篩選與瀏覽共用 FilterSpec（`filterSpecForPage(…, "browse")` → `filterSpecToReadQuery`）；查詢規則在 Use Case → repository/browse-groups.ts。
 */
import { filterSpecToQueryString, type FilterSpec } from "@sok/api-contract";
import { formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import {
  GAME_GROUP_INITIAL,
  type GameGroup,
  type GroupedBy,
  type IgnoredFilterValue,
} from "../../../domain/entities";
import { publisherColumnName, type PublisherColumnKey } from "../../../domain/publisher-groups";
import { getGameGroupPage, getGameGroups } from "../../../use-cases/read";
import { filterSpecToReadQuery } from "../../filter-mapping";
import { getTranslator } from "../../labels";
import { toGroupCard } from "./group-card-data";
import type { GroupCardData, GroupMoreResponse } from "./group-card";
import type { GroupViewParams } from "./params";

/** 頁面用的一組（已格式化成字串）。 */
export interface GroupView {
  key: string;
  title: string;
  total: number;
  /** 已隨頁面送出的卡片。 */
  cards: GroupCardData[];
}

export interface GameGroupsQuery {
  locale: Locale;
  /** 已套用 browse 頁面規則的 FilterSpec。 */
  spec: FilterSpec;
  by: GroupedBy;
}

/** 「顯示更多」API 的基底網址（客戶端再接 key、offset、limit）。篩選參數與頁面同一組。 */
export function groupApiBase(locale: Locale, by: GroupedBy, spec: FilterSpec): string {
  // 分組檢視組內順序固定（發售日由新到舊），sort 不影響結果，不放進網址（CDN 快取鍵不因 sort 分裂）；組排序／起算月只決定「哪些組」，API 以組 key 取卡片，也不需要
  const { sort: _sort, ...rest } = spec;
  void _sort;
  const query = filterSpecToQueryString(rest);
  return `/api/v1/games/group?locale=${locale}&by=${by}${query ? `&${query}` : ""}`;
}

/** 日期組 key → 標題：`2026-10` → 「2026年10月」、`2026-Q4` → 「2026 年第 4 季」、`2026` → 「2026 年」、`tbd` → 「日期未定」。 */
export function dateGroupTitle(key: string, locale: Locale): string {
  if (key === "tbd") return formatReleaseLabel(null, "tbd", locale);
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (q) return formatReleaseLabel(`${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`, "quarter", locale);
  if (/^\d{4}$/.test(key)) return formatReleaseLabel(`${key}-01-01`, "year", locale);
  return formatReleaseLabel(`${key}-01`, "month", locale);
}

export function groupTitle(group: GameGroup, by: GroupedBy, locale: Locale): string {
  if (by === "date") return dateGroupTitle(group.key, locale);
  if (by === "platform") return group.platform?.name ?? group.key;
  return publisherColumnName(group.key as PublisherColumnKey, locale);
}


export async function loadGameGroups(
  q: GameGroupsQuery & { page: number; view?: Partial<GroupViewParams> },
  t: Translator = getTranslator(q.locale),
): Promise<{ groups: GroupView[]; hasMoreGroups: boolean; ignored: IgnoredFilterValue[] }> {
  const rq = filterSpecToReadQuery(q.spec);
  const res = await getGameGroups({
    by: q.by,
    page: q.page,
    groupSort: q.view?.sort,
    groupDir: q.view?.dir,
    groupFrom: q.view?.from,
    perGroup: GAME_GROUP_INITIAL,
    filter: rq.filter,
    yearFrom: rq.yearFrom,
    yearTo: rq.yearTo,
    q: rq.q,
    locale: q.locale,
  });
  return {
    hasMoreGroups: res.hasMoreGroups,
    ignored: res.ignored,
    groups: res.groups.map(
      (g): GroupView => ({
        key: g.key,
        title: groupTitle(g, q.by, q.locale),
        total: g.total,
        cards: g.cards.map((c) => toGroupCard(c, q.locale, t)),
      }),
    ),
  };
}

export interface GroupMoreQuery extends GameGroupsQuery {
  key: string;
  offset: number;
  limit: number;
}

/** 「顯示更多」：某一組接續的卡片。組 key 不合法或沒有更多 → cards 為空。 */
export async function loadGroupMore(q: GroupMoreQuery, t: Translator = getTranslator(q.locale)): Promise<GroupMoreResponse> {
  const rq = filterSpecToReadQuery(q.spec);
  const group = await getGameGroupPage({
    by: q.by,
    key: q.key,
    offset: q.offset,
    limit: q.limit,
    filter: rq.filter,
    yearFrom: rq.yearFrom,
    yearTo: rq.yearTo,
    q: rq.q,
    locale: q.locale,
  });
  return { key: q.key, total: group?.total ?? 0, cards: (group?.cards ?? []).map((c) => toGroupCard(c, q.locale, t)) };
}
