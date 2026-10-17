/**
 * 首頁儀表板的挑選規則（純函式，唯一實作）。
 * 資料本身來自聚合規則（listReleaseCards）；這裡只決定「視窗內挑哪幾款、怎麼排」：
 * 一款遊戲只出現一次（取視窗內最早的一張卡）→ 依熱度挑出前 limit 款 → 再依日期排序（即將：近到遠；最新：新到舊）。
 */
import type { HomeGameCard, ReleaseCard } from "./entities";

export const HOME_UPCOMING_DAYS = 30;
export const HOME_RECENT_DAYS = 30;
export const HOME_SECTION_LIMIT = 12;
export const HOME_EVENT_LIMIT = 6;
export const HOME_TRENDING_LIMIT = 12;
export const HOME_CARD_PLATFORM_LIMIT = 3;

const byHeat = (a: ReleaseCard, b: ReleaseCard): number =>
  b.popularityScore - a.popularityScore || a.name.localeCompare(b.name) || a.gameId - b.gameId;

/** order＝asc：即將上市（近到遠）；desc：最新上市（新到舊）。只處理有日期的卡。 */
export function pickHomeCards(cards: readonly ReleaseCard[], limit: number, order: "asc" | "desc"): HomeGameCard[] {
  const sign = order === "asc" ? 1 : -1;
  const earliest = new Map<number, ReleaseCard>();
  for (const c of cards) {
    if (!c.date) continue;
    const prev = earliest.get(c.gameId);
    // 近的優先（asc：最早；desc：最晚）
    if (!prev || (sign > 0 ? c.date < prev.date! : c.date > prev.date!)) earliest.set(c.gameId, c);
  }
  const top = [...earliest.values()].sort(byHeat).slice(0, Math.max(0, limit));
  top.sort((a, b) => sign * (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0) || byHeat(a, b));
  return top.map(toHomeCard);
}

function toHomeCard(c: ReleaseCard): HomeGameCard {
  return {
    gameId: c.gameId,
    slug: c.slug,
    name: c.name,
    originalName: c.originalName,
    cover: c.cover,
    date: c.date!,
    precision: c.precision,
    platforms: c.platforms.slice(0, HOME_CARD_PLATFORM_LIMIT),
    platformMore: Math.max(0, c.platforms.length - HOME_CARD_PLATFORM_LIMIT),
    heatLevel: c.heatLevel,
    gameType: c.gameType,
  };
}

/** UTC 日期加減天數（YYYY-MM-DD）。 */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
