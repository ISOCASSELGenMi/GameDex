import {
  MY_GAMES_IDS_MAX,
  MY_GAMES_LIMIT_DEFAULT,
  MY_GAMES_LIMIT_MAX,
  type IsoDate,
  type MyGameItem,
  type MyGameRelease,
  type MyGamesPage,
  type ReleaseCard,
} from "../../domain/entities";
import { utcToday } from "../../domain/utc-date";
import { resolveImageRef } from "../../providers/image-ref";
import { getGameMiniCardsByIds } from "../../repository/game-cards";
import { aggregateReleases, DEFAULT_AGGREGATE_PRECISIONS } from "../../repository/release-aggregate";
import { resolveFilterSlugs, resolveRegionPref } from "./resolve-filter";

export interface GetMyGamesInput {
  /** 使用者的遊戲 id 集合（由 GameFilterProvider 解析；重複的會去重，超過 MY_GAMES_IDS_MAX 的截斷）。 */
  gameIds: readonly number[];
  /** 代表日期區間（含）；有給任一個時，只回在區間內有上市日的遊戲。 */
  from?: IsoDate | null;
  to?: IsoDate | null;
  locale: string | null;
  regionPref?: string | null;
  /** 預設 24、上限 100。 */
  limit?: number;
  offset?: number;
  /** 測試用：固定「今天」（UTC 日期）。 */
  today?: IsoDate;
}

/** 代表期間的最後一天（month 的代表日是 1 日，其餘已是期間最後一天；同 periodEndSql）。 */
function periodEnd(card: Pick<ReleaseCard, "date" | "precision">): string | null {
  if (!card.date) return null;
  if (card.precision !== "month") return card.date;
  const y = Number(card.date.slice(0, 4));
  const m = Number(card.date.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const RANK = { upcoming: 0, tbd: 1, past: 2 } as const;

/** 一款遊戲的卡片之中挑「最近的上市日」：未來最早 → 日期未定 → 過去最近。 */
export function pickNextRelease(cards: readonly ReleaseCard[], today: string): { card: ReleaseCard; relation: MyGameRelease["relation"] } | null {
  let best: { card: ReleaseCard; relation: MyGameRelease["relation"] } | null = null;
  const better = (a: { card: ReleaseCard; relation: MyGameRelease["relation"] }, b: typeof a): boolean => {
    if (RANK[a.relation] !== RANK[b.relation]) return RANK[a.relation] < RANK[b.relation];
    if (a.relation === "past") return (a.card.date ?? "") > (b.card.date ?? "");
    if (a.relation === "upcoming") return (a.card.date ?? "") < (b.card.date ?? "");
    return false;
  };
  for (const card of cards) {
    const end = periodEnd(card);
    const relation: MyGameRelease["relation"] = card.precision === "tbd" || end === null ? "tbd" : end >= today ? "upcoming" : "past";
    const cand = { card, relation };
    if (!best || better(cand, best)) best = cand;
  }
  return best;
}

/**
 * 「我的遊戲」（Phase 7 第 6 波）：給定遊戲 id 集合，回遊戲卡片＋最近的上市日。
 * 上市日用 aggregateReleases（06 聚合規則的唯一實作，與月曆相同的預設篩選與地區偏好）；不另寫一份聚合。
 * 排序：有未來上市日（日期近到遠）→ 日期未定 → 只有過去的（近到遠）→ 沒有上市資料（遊戲 id 大到小）。
 * 給了 from／to：只含在區間內有上市日的遊戲，卡片的上市日也限於區間內。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getMyGames(input: GetMyGamesInput): Promise<MyGamesPage> {
  const limit = Math.min(MY_GAMES_LIMIT_MAX, Math.max(1, finiteInt(input.limit, MY_GAMES_LIMIT_DEFAULT)));
  const offset = Math.max(0, finiteInt(input.offset, 0));
  const today = input.today ?? utcToday();
  const ids = [...new Set(input.gameIds.filter((i) => Number.isSafeInteger(i) && i > 0))].slice(0, MY_GAMES_IDS_MAX);
  if (ids.length === 0) return { items: [], total: 0, hasMore: false, limit, offset };

  const { filter } = await resolveFilterSlugs();
  const ranged = !!(input.from || input.to);
  const cards = await aggregateReleases({
    gameIds: ids,
    from: input.from ?? null,
    to: input.to ?? null,
    // 有區間時 tbd 沒有日期、不屬於任何區間；沒有區間時一併取日期未定的
    precisions: ranged ? DEFAULT_AGGREGATE_PRECISIONS : [...DEFAULT_AGGREGATE_PRECISIONS, "tbd"],
    filter,
    regionPref: resolveRegionPref(input.regionPref),
    locale: input.locale ?? "",
    today,
    resolveImage: resolveImageRef,
  });
  const byGame = new Map<number, ReleaseCard[]>();
  for (const c of cards) {
    const list = byGame.get(c.gameId) ?? [];
    list.push(c);
    byGame.set(c.gameId, list);
  }

  const entries = (ranged ? [...byGame.keys()] : ids).map((gameId) => {
    const picked = pickNextRelease(byGame.get(gameId) ?? [], today);
    return { gameId, picked, popularity: picked?.card.popularityScore ?? 0 };
  });
  entries.sort((a, b) => {
    const ra = a.picked ? RANK[a.picked.relation] : 3;
    const rb = b.picked ? RANK[b.picked.relation] : 3;
    if (ra !== rb) return ra - rb;
    if (a.picked && b.picked) {
      const da = a.picked.card.date ?? "";
      const db = b.picked.card.date ?? "";
      if (da !== db) return a.picked.relation === "past" ? (da < db ? 1 : -1) : da < db ? -1 : 1;
      if (a.popularity !== b.popularity) return b.popularity - a.popularity;
    }
    return b.gameId - a.gameId;
  });

  const page = entries.slice(offset, offset + limit);
  const minis = await getGameMiniCardsByIds(page.map((e) => e.gameId), input.locale, resolveImageRef);
  const items: MyGameItem[] = [];
  for (const e of page) {
    const game = minis.get(e.gameId);
    if (!game) continue; // 遊戲已被刪（理論上 id 集合來自有 FK 的表）
    items.push({
      game,
      nextRelease: e.picked
        ? {
            date: e.picked.card.precision === "tbd" ? null : e.picked.card.date,
            precision: e.picked.card.precision,
            stage: e.picked.card.stage,
            status: e.picked.card.status,
            platforms: e.picked.card.platforms,
            relation: e.picked.relation,
          }
        : null,
    });
  }
  return { items, total: entries.length, hasMore: offset + limit < entries.length, limit, offset };
}

const finiteInt = (v: number | undefined, fallback: number) => (v != null && Number.isFinite(v) ? Math.floor(v) : fallback);
