/**
 * 時間軸：TimelinePage（catalog 讀取模型）→ 畫面資料（純函式，只依賴字典與 Intl）。
 * 跨頁合併（同 key 的組）、「今天」線位置、月份區段分組也在這裡（客戶端元件共用，所以不 import 任何伺服器端程式）。
 */
import { formatIsoDate, formatReleaseLabel, formatYearMonth, type Locale, type Translator } from "@sok/i18n";
import type { ReleaseCard, TimelineGroup, TimelinePage } from "../../domain/entities";
import { heatBadgeLabel } from "../heat-badge";
import { stageLabel, statusLabel } from "../labels";
import { gameHref } from "../links";
import { joinList, platformChipText } from "../calendar/view-model";
import type { TimelineCardData, TimelineChunk, TimelineGroupData } from "./types";

/** 卡片 → 傳輸用資料。 */
export function toTimelineCard(card: ReleaseCard, locale: Locale, t: Translator): TimelineCardData {
  const out: TimelineCardData = {
    k: `${card.gameId}-${card.stage}`,
    h: gameHref(locale, card.slug),
    n: card.name,
    p: card.platforms.map(platformChipText),
    pn: joinList(locale, card.platforms.map((p) => p.name)),
    sk: card.stage,
    s: stageLabel(t, card.stage),
  };
  if (card.originalName && card.originalName !== card.name) out.o = card.originalName;
  if (card.cover) out.c = card.cover.small;
  if (card.precision !== "day" && card.precision !== "tbd") out.pl = t.t(`ui.calendar.undatedGroups.${card.precision}`);
  if (card.status === "delayed" || card.status === "cancelled") {
    out.tk = card.status;
    out.t = statusLabel(t, card.status);
  }
  if (card.sourceStatus === "removed") out.r = 1;
  const heat = heatBadgeLabel(t, card.heatLevel);
  if (heat) {
    out.hv = card.heatLevel;
    out.hl = heat;
  }
  if (card.hasDateHistory && card.releaseEventIds.length > 0) out.ids = card.releaseEventIds;
  return out;
}

/** 月份區段標題（「2026年10月」「日期未定」）。 */
export function timelineMonthTitle(month: string | null, locale: Locale, t: Translator): string {
  if (month === null) return t.t("ui.timeline.tbdSection");
  const [y, m] = month.split("-").map(Number) as [number, number];
  return formatYearMonth(y, m, locale);
}

/** 組標題：日＝「10月13日 星期二」；月／季／年＝「只確定月份：2026年12月」；tbd＝「日期未定」。 */
export function timelineGroupTitle(group: Pick<TimelineGroup, "kind" | "periodStart">, locale: Locale, t: Translator): string {
  if (group.kind === "tbd" || group.periodStart === null) return t.t("ui.timeline.tbdSection");
  if (group.kind === "day") return formatIsoDate(group.periodStart, locale, { month: "long", day: "numeric", weekday: "long" });
  return t.t("ui.calendar.undatedGroupTitle", {
    group: t.t(`ui.calendar.undatedGroups.${group.kind}`),
    label: formatReleaseLabel(group.periodStart, group.kind, locale),
  });
}

export function toTimelineGroup(group: TimelineGroup, locale: Locale, t: Translator): TimelineGroupData {
  return {
    key: group.key,
    kind: group.kind,
    periodStart: group.periodStart,
    month: group.month,
    monthTitle: timelineMonthTitle(group.month, locale, t),
    title: timelineGroupTitle(group, locale, t),
    cards: group.cards.map((c) => toTimelineCard(c, locale, t)),
    totalCount: group.totalCount,
    hiddenCount: group.hiddenCount,
    continuesFromPrev: group.continuesFromPrev,
    continuesToNext: group.continuesToNext,
  };
}

export function buildTimelineChunk(page: TimelinePage, locale: Locale, t: Translator): TimelineChunk {
  return {
    groups: page.groups.map((g) => toTimelineGroup(g, locale, t)),
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}

/** 卡片依 key 去重（保留先出現的）。 */
export function dedupeCards(cards: readonly TimelineCardData[]): TimelineCardData[] {
  const seen = new Set<string>();
  const out: TimelineCardData[] = [];
  for (const c of cards) {
    if (seen.has(c.k)) continue;
    seen.add(c.k);
    out.push(c);
  }
  return out;
}

/** 把一組（同 key）的新卡接到舊組（direction=next：接在後面；prev：插在前面）。 */
export function mergeGroupCards(existing: TimelineGroupData, incoming: TimelineGroupData, direction: "next" | "prev"): TimelineGroupData {
  if (direction === "next") {
    return {
      ...existing,
      cards: dedupeCards([...existing.cards, ...incoming.cards]),
      totalCount: Math.max(existing.totalCount, incoming.totalCount),
      hiddenCount: Math.max(existing.hiddenCount, incoming.hiddenCount),
      continuesToNext: incoming.continuesToNext,
    };
  }
  return {
    ...existing,
    cards: dedupeCards([...incoming.cards, ...existing.cards]),
    totalCount: Math.max(existing.totalCount, incoming.totalCount),
    hiddenCount: Math.max(existing.hiddenCount, incoming.hiddenCount),
    continuesFromPrev: incoming.continuesFromPrev,
  };
}

/**
 * 合併新載入的一頁。頁界可能切在組中間：同 key 的組合併成一組，其餘直接接上。
 * - next：incoming 接在後面，nextCursor 取 incoming 的，prevCursor 保留
 * - prev：incoming 插在前面，prevCursor 取 incoming 的，nextCursor 保留
 */
export function mergeTimelineChunk(existing: TimelineChunk, incoming: TimelineChunk, direction: "next" | "prev"): TimelineChunk {
  if (existing.groups.length === 0) return { ...incoming };
  const groups = [...existing.groups];
  if (direction === "next") {
    const last = groups[groups.length - 1]!;
    const rest = [...incoming.groups];
    if (rest[0] && rest[0].key === last.key) groups[groups.length - 1] = mergeGroupCards(last, rest.shift()!, "next");
    return { groups: [...groups, ...rest], nextCursor: incoming.nextCursor, prevCursor: existing.prevCursor };
  }
  const first = groups[0]!;
  const head = [...incoming.groups];
  if (head.length > 0 && head[head.length - 1]!.key === first.key) groups[0] = mergeGroupCards(first, head.pop()!, "prev");
  return { groups: [...head, ...groups], nextCursor: existing.nextCursor, prevCursor: incoming.prevCursor };
}

/** 展開某組：把新取得的卡接在後面（去重）。找不到該組則原樣回傳。 */
export function appendGroupCards(chunk: TimelineChunk, key: string, cards: readonly TimelineCardData[], totalCount: number): TimelineChunk {
  return {
    ...chunk,
    groups: chunk.groups.map((g) => (g.key === key ? { ...g, cards: dedupeCards([...g.cards, ...cards]), totalCount } : g)),
  };
}

/** 組內尚未載入的卡片數（「展開（剩 M 款）」的 M）：總數 − 目前已載入；組還在跨頁（continuesToNext）時為 0（等下一頁）。 */
export function remainingInGroup(group: TimelineGroupData): number {
  if (group.continuesToNext) return 0;
  // 有預覽上限：未展開時 hiddenCount＝totalCount − 預覽筆數；展開後依已載入張數遞減
  return Math.max(0, Math.min(group.hiddenCount, group.totalCount - group.cards.length));
}

export interface MonthSection {
  month: string | null;
  title: string;
  groups: TimelineGroupData[];
}

/** 依月份區段分組（groups 已依時間排序，同月連續）。 */
export function groupByMonth(groups: readonly TimelineGroupData[]): MonthSection[] {
  const out: MonthSection[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && last.month === g.month) last.groups.push(g);
    else out.push({ month: g.month, title: g.monthTitle, groups: [g] });
  }
  return out;
}

/**
 * 「今天」線插在哪一組之前（回傳該組的 index；groups.length＝接在最後一個有日期的組之後；null＝不顯示）。
 * - 找第一個 periodStart ≥ today 的組（tbd 不算）
 * - 前面還有更早的組，或這一頁就是從今天開始（startsAtToday）才顯示；
 *   全部都早於今天且後面還有（nextCursor）→ 還沒捲到今天，不顯示
 */
export function todayMarkerIndex(groups: readonly TimelineGroupData[], today: string, opts: { startsAtToday: boolean; hasNext: boolean }): number | null {
  const dated = groups.filter((g) => g.periodStart !== null);
  if (dated.length === 0) return null;
  const idx = groups.findIndex((g) => g.periodStart !== null && g.periodStart >= today);
  if (idx === -1) {
    if (opts.hasNext) return null;
    const lastDated = groups.map((g) => g.periodStart !== null).lastIndexOf(true);
    return lastDated + 1;
  }
  if (idx > 0 || opts.startsAtToday) return idx;
  return null;
}
