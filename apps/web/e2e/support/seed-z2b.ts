/**
 * GameDex 第 2 輪 Z2B（評分排名）的 e2e 評分資料（由 seed.ts 在最後呼叫）：IGDB 分數與站內玩家平均（site_players／user_average）。
 * 玩家平均直接寫 ratings（e2e 伺服器不跑排程；等同 publish_player_ratings 的結果）。
 */
import { inArray } from "drizzle-orm";
import type { getDb } from "@/kernel/db/client";
import { games, ratings } from "@/modules/catalog/schema";
import { FIXTURE_Z2B as F, fillerScore } from "./fixture-z2b";

type Db = ReturnType<typeof getDb>;

export async function seedZ2b(db: Db): Promise<void> {
  const fillers = Array.from({ length: F.fillerCount }, (_, i) => `e2e-fill-${String(i).padStart(2, "0")}`);
  const slugs = [...Object.keys(F.igdb), ...fillers, ...Object.keys(F.players)];
  const rows = await db.select({ id: games.id, slug: games.slug }).from(games).where(inArray(games.slug, slugs));
  const id = new Map(rows.map((r) => [r.slug, r.id]));
  const need = (slug: string): number => {
    const v = id.get(slug);
    if (v === undefined) throw new Error(`Z2B fixture：找不到遊戲 ${slug}`);
    return v;
  };
  const values: Array<typeof ratings.$inferInsert> = [];
  for (const [slug, [score, count]] of Object.entries(F.igdb)) {
    values.push({ gameId: need(slug), scoreOrigin: "igdb-aggregate", scoreProvider: "igdb", scoreType: "critic_aggregate", score, scoreMax: 100, reviewCount: count });
  }
  fillers.forEach((slug, i) => {
    values.push({ gameId: need(slug), scoreOrigin: "igdb-aggregate", scoreProvider: "igdb", scoreType: "critic_aggregate", score: fillerScore(i), scoreMax: 100, reviewCount: 20 });
  });
  for (const [slug, [score, count]] of Object.entries(F.players)) {
    values.push({ gameId: need(slug), scoreOrigin: "site-players", scoreProvider: "site_players", scoreType: "user_average", score, scoreMax: 100, reviewCount: count });
  }
  await db.insert(ratings).values(values);
}
