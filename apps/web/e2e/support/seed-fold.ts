/**
 * 月曆未定日摺起來的組（方案 A）的 e2e fixture（由 seed.ts 呼叫）：2038-12 年精度 30 款、季精度 24 款。
 */
import type { getDb } from "@/kernel/db/client";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { gamePlatforms, games, releaseEvents } from "@/modules/catalog/schema";
import { FIXTURE_FOLD as F, foldName } from "./fixture-fold";

type Db = ReturnType<typeof getDb>;

export async function seedFold(db: Db, region: Record<string, number>, platform: Record<string, number>): Promise<void> {
  let igdb = 449001;
  const group = async (count: number, prefix: string, slugPrefix: string, popBase: number, precision: "year" | "quarter"): Promise<void> => {
    for (let i = 1; i <= count; i++) {
      const name = foldName(prefix, i);
      const date = "2038-12-31";
      const [g] = await db
        .insert(games)
        .values({
          igdbId: igdb++,
          slug: `${slugPrefix}-${String(i).padStart(2, "0")}`,
          name,
          gameType: "main_game",
          popularityScore: popBase - i,
          firstReleaseDate: date,
          firstReleasePrecision: precision,
          searchText: buildSearchText([name]),
        })
        .returning({ id: games.id });
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: platform[F.platform]! });
      await db.insert(releaseEvents).values({
        gameId: g!.id,
        platformId: platform[F.platform]!,
        regionId: region.WW!,
        releaseDate: date,
        periodStart: precision === "year" ? "2038-01-01" : "2038-10-01",
        precision,
        releaseStage: "full",
        status: "scheduled",
        sourceStatus: "active",
        source: "igdb",
      });
    }
  };
  await group(F.yearGroup.count, F.yearGroup.prefix, F.yearGroup.slugPrefix, 400, "year");
  await group(F.quarterGroup.count, F.quarterGroup.prefix, F.quarterGroup.slugPrefix, 300, "quarter");
}
