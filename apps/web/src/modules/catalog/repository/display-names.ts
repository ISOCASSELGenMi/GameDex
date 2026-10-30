/**
 * games.display_names 的全庫重算（recompute_display_names 任務）：規則（domain/display-names.ts）改動後，
 * 依 games.alternative_names 與 game_localizations 重新計算，只更新與現值不同的列、只動 display_names
 * （不碰 search_text、updated_at、change_feed）。一批一個 transaction，依 id 遞增游標。
 */
import { asc, eq, gt, inArray } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { resolveDisplayNames } from "../domain/display-names";
import { buildSearchText } from "../domain/search-text";
import { gameLocalizations, games } from "../schema";

export interface DisplayNamesBatchResult {
  scanned: number;
  updated: number;
  /** 重算後失去 zh-Hant 的遊戲數（規則收緊時會出現）。 */
  removedZhHant: number;
  /** 本批最後一款的 id；沒有資料＝null（掃描結束）。 */
  lastId: number | null;
}

/**
 * 一款遊戲的顯示名稱（人工優先）與搜尋字串。同步寫入（game-sync.ts）與回報核可新增繁中標題（applyManualZhHantTitle）共用，
 * `base` 給了就不再讀 games（同步剛 upsert 過，已知名稱與別名）。
 */
export async function computeGameNames(
  tx: DbOrTx,
  gameId: number,
  base?: { name: string; alternativeNames: Array<{ name: string; comment: string | null }> },
): Promise<{ displayNames: Record<string, string>; searchText: string }> {
  let game = base;
  if (!game) {
    const [row] = await tx.select({ name: games.name, alternativeNames: games.alternativeNames }).from(games).where(eq(games.id, gameId)).limit(1);
    game = { name: row?.name ?? "", alternativeNames: row?.alternativeNames ?? [] };
  }
  const locs = await tx
    .select({ localeCode: gameLocalizations.localeCode, name: gameLocalizations.name, source: gameLocalizations.source })
    .from(gameLocalizations)
    .where(eq(gameLocalizations.gameId, gameId));
  return {
    displayNames: resolveDisplayNames(locs, game.alternativeNames),
    searchText: buildSearchText([game.name, ...game.alternativeNames.map((a) => a.name), ...locs.map((l) => l.name)]),
  };
}

/** 核可 localized_title：寫入（或覆蓋）manual 的 zh-Hant 標題，並重算該遊戲的 display_names 與 search_text。 */
export async function applyManualZhHantTitle(tx: DbOrTx, gameId: number, title: string): Promise<void> {
  await tx
    .insert(gameLocalizations)
    .values({ gameId, localeCode: "zh-Hant", name: title, source: "manual" })
    .onConflictDoUpdate({ target: [gameLocalizations.gameId, gameLocalizations.localeCode], set: { name: title, source: "manual" } });
  await tx.update(games).set(await computeGameNames(tx, gameId)).where(eq(games.id, gameId));
}

const sameNames =(a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

export async function recomputeDisplayNamesBatch(afterId: number, limit: number, db: DbOrTx = getDb()): Promise<DisplayNamesBatchResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: games.id, alternativeNames: games.alternativeNames, displayNames: games.displayNames })
      .from(games)
      .where(gt(games.id, afterId))
      .orderBy(asc(games.id))
      .limit(limit);
    if (rows.length === 0) return { scanned: 0, updated: 0, removedZhHant: 0, lastId: null };

    const locs = await tx
      .select({ gameId: gameLocalizations.gameId, localeCode: gameLocalizations.localeCode, name: gameLocalizations.name, source: gameLocalizations.source })
      .from(gameLocalizations)
      .where(inArray(gameLocalizations.gameId, rows.map((r) => r.id)));
    const locsByGame = new Map<number, typeof locs>();
    for (const l of locs) locsByGame.set(l.gameId, [...(locsByGame.get(l.gameId) ?? []), l]);

    let updated = 0;
    let removedZhHant = 0;
    for (const r of rows) {
      const next = resolveDisplayNames(locsByGame.get(r.id) ?? [], r.alternativeNames ?? []);
      const current = r.displayNames ?? {};
      if (sameNames(current, next)) continue;
      await tx.update(games).set({ displayNames: next }).where(eq(games.id, r.id));
      updated += 1;
      if (current["zh-Hant"] && !next["zh-Hant"]) removedZhHant += 1;
    }
    return { scanned: rows.length, updated, removedZhHant, lastId: rows[rows.length - 1]!.id };
  });
}
