/**
 * GameDex 第 2 輪 Z2A（瀏覽頁分組檢視）的 e2e fixture（由 seed.ts 在最後呼叫）。
 * 公司用真實的 IGDB id（FromSoftware 1012、萬代南夢宮 248、任天堂 70、卡普空 37），讓廠商組的歸屬走真正的對照表。
 */
import type { getDb } from "@/kernel/db/client";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { companies, gameCompanies, gamePlatforms, games, releaseEvents } from "@/modules/catalog/schema";
import { FIXTURE_Z2A as F } from "./fixture-z2a";

type Db = ReturnType<typeof getDb>;
type Precision = "day" | "quarter" | "year" | "tbd";

export async function seedZ2a(db: Db, region: Record<string, number>, platform: Record<string, number>): Promise<void> {
  const company: Record<string, number> = {};
  for (const [key, igdbId, name] of [
    ["fromsoftware", 1012, "FromSoftware"],
    ["bandai", 248, "Bandai Namco Entertainment"],
    ["nintendo", 70, "Nintendo"],
    ["capcom", 37, "Capcom"],
    ["indie", 446950, "Z2A Indie Studio"],
  ] as const) {
    const [row] = await db.insert(companies).values({ igdbId, name, slug: `e2e-z2a-co-${key}` }).returning({ id: companies.id });
    company[key] = row!.id;
  }

  let igdb = 446001;
  const add = async (
    slug: string,
    name: string,
    popularityScore: number,
    when: { date: string; precision: Precision } | null,
    platformKeys: string[],
    credits: { company: string; role: "developer" | "publisher" }[] = [],
  ): Promise<void> => {
    const [g] = await db
      .insert(games)
      .values({
        igdbId: igdb++,
        slug,
        name,
        gameType: "main_game",
        popularityScore,
        firstReleaseDate: when?.date ?? null,
        firstReleasePrecision: when?.precision ?? "tbd",
        coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/e2e${igdb}.jpg`,
        searchText: buildSearchText([name]),
      })
      .returning({ id: games.id });
    for (const p of platformKeys) {
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: platform[p]! });
      if (when) {
        await db.insert(releaseEvents).values({
          gameId: g!.id,
          platformId: platform[p]!,
          regionId: region.WW!,
          releaseDate: when.date,
          periodStart: when.date,
          precision: when.precision,
          releaseStage: "full",
          status: "scheduled",
          sourceStatus: "active",
          source: "igdb",
        });
      }
    }
    for (const c of credits) await db.insert(gameCompanies).values({ gameId: g!.id, companyId: company[c.company]!, role: c.role });
  };

  const { ps5, switch: sw, pc } = F.platforms;
  const day = (date: string) => ({ date, precision: "day" as const });
  await add(F.elden.slug, F.elden.name, 900, day("2036-09-10"), [ps5, pc], [
    { company: "bandai", role: "publisher" },
    { company: "fromsoftware", role: "developer" },
    { company: "fromsoftware", role: "publisher" },
  ]);
  await add(F.zelda.slug, F.zelda.name, 800, day("2036-09-10"), [sw], [
    { company: "indie", role: "developer" },
    { company: "nintendo", role: "publisher" },
  ]);
  await add(F.indie.slug, F.indie.name, 100, day("2036-09-10"), [pc], [{ company: "indie", role: "developer" }]);
  await add(F.capcom.slug, F.capcom.name, 700, day("2036-09-20"), [ps5], [{ company: "capcom", role: "developer" }]);
  for (let i = 1; i <= F.bulk.count; i++) {
    const n = String(i).padStart(2, "0");
    await add(`e2e-z2a-bulk-${n}`, `Z2A Bulk ${n}`, 500 - i, day(F.bulk.day), [pc]);
  }
  await add(F.quarter.slug, F.quarter.name, 90, { date: "2036-10-01", precision: "quarter" }, [pc]);
  await add(F.year.slug, F.year.name, 80, { date: "2037-01-01", precision: "year" }, [pc]);
  await add(F.undated.slug, F.undated.name, 70, null, []);
}
