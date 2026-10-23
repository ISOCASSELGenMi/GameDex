/**
 * GameDex 第 2 輪 Z4B（遊戲詳情頁補資訊）的 e2e fixture（由 seed.ts 在最後呼叫）。
 * 主作、版本、DLC、資料片、移植、本地化標題、別名、遊戲模式、玩家視角、引擎、故事。
 * 需要 Z4A 的 schema（versionParentId／versionTitle／storyline、game_modes 等表）。
 */
import type { getDb } from "@/kernel/db/client";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import {
  companies,
  gameCompanies,
  gameEngines,
  gameGameEngines,
  gameGameModes,
  gameLocalizations,
  gameModes,
  gamePlatforms,
  gamePlayerPerspectives,
  games,
  playerPerspectives,
  releaseEvents,
} from "@/modules/catalog/schema";
import { FIXTURE_Z4B as F } from "./fixture-z4b";

type Db = ReturnType<typeof getDb>;

const longText = (start: string): string =>
  `${start}. ` +
  Array.from({ length: 14 }, (_, i) => `Sentence ${i + 1} of a deliberately long passage that keeps going so the text overflows three lines on every viewport.`).join(" ");

export async function seedZ4b(db: Db, region: Record<string, number>, platform: Record<string, number>): Promise<void> {
  const company: Record<string, number> = {};
  for (const [key, igdbId, name] of [
    ["dev", 447901, "Z4B Dev Studio"],
    ["pub", 447902, "Z4B Publisher"],
    ["support", 447903, "Z4B Support Studio"],
    ["port", 447904, "Z4B Port Studio"],
  ] as const) {
    const [row] = await db.insert(companies).values({ igdbId, name, slug: `e2e-z4b-co-${key}` }).returning({ id: companies.id });
    company[key] = row!.id;
  }

  let nextIgdb = F.main.igdbId + 1;
  const add = async (
    slug: string,
    name: string,
    over: Partial<typeof games.$inferInsert>,
    when: { date: string } | null,
    platformKeys: string[],
  ): Promise<{ id: number; igdbId: number }> => {
    const igdbId = over.igdbId ?? nextIgdb++;
    const [g] = await db
      .insert(games)
      .values({
        gameType: "main_game",
        popularityScore: 10,
        firstReleaseDate: when?.date ?? null,
        firstReleasePrecision: when ? "day" : "tbd",
        coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/e2e${igdbId}.jpg`,
        searchText: buildSearchText([name]),
        ...over,
        slug,
        name,
        igdbId,
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
          precision: "day",
          releaseStage: "full",
          status: "scheduled",
          sourceStatus: "active",
          source: "igdb",
        });
      }
    }
    return { id: g!.id, igdbId };
  };

  const { ps5, switch: sw } = F.platforms;
  const main = await add(
    F.main.slug,
    F.main.name,
    {
      igdbId: F.main.igdbId,
      popularityScore: 400,
      summary: longText("Z4B summary"),
      storyline: longText(F.storyStart),
      alternativeNames: F.alternative.map((a) => ({ ...a })),
      screenshotUrls: ["https://images.igdb.com/igdb/image/upload/t_screenshot_big/e2ez4bshot.jpg"],
      trailerUrl: "https://www.youtube.com/watch?v=z4btrailer",
    },
    { date: F.main.date },
    [ps5, sw],
  );
  const credits: Array<[string, "developer" | "publisher" | "supporting" | "porting"]> = [
    ["dev", "developer"],
    ["pub", "publisher"],
    ["support", "supporting"],
    ["port", "porting"],
  ];
  for (const [key, role] of credits) await db.insert(gameCompanies).values({ gameId: main.id, companyId: company[key]!, role });
  for (const l of F.localized) await db.insert(gameLocalizations).values({ gameId: main.id, localeCode: l.localeCode, name: l.name, source: "igdb" });

  const modeRows = await db
    .insert(gameModes)
    .values([
      { igdbId: 447801, name: "Single player", slug: "single-player" },
      { igdbId: 447802, name: "Co-operative", slug: "co-operative" },
    ])
    .returning({ id: gameModes.id });
  for (const m of modeRows) await db.insert(gameGameModes).values({ gameId: main.id, gameModeId: m.id });
  const [persp] = await db.insert(playerPerspectives).values({ igdbId: 447811, name: "Third person", slug: "third-person" }).returning({ id: playerPerspectives.id });
  await db.insert(gamePlayerPerspectives).values({ gameId: main.id, playerPerspectiveId: persp!.id });
  const [engine] = await db.insert(gameEngines).values({ igdbId: 447821, name: "Z4B In-house engine", slug: "z4b-in-house-engine" }).returning({ id: gameEngines.id });
  await db.insert(gameGameEngines).values({ gameId: main.id, gameEngineId: engine!.id });

  // 版本（version_parent，不是 DLC）
  await add(F.edition.slug, F.edition.name, { versionParentId: main.igdbId, versionTitle: F.edition.versionTitle }, { date: "2038-06-01" }, [sw]);
  // DLC（26 款，超過每組上限 24）
  for (let i = 1; i <= F.dlc.count; i++) {
    const n = String(i).padStart(2, "0");
    await add(`${F.dlc.prefix}${n}`, `Z4B DLC ${n}`, { gameType: "dlc_addon", parentGameId: main.igdbId }, { date: `2038-03-${n}` }, [ps5]);
  }
  await add(F.expansion.slug, F.expansion.name, { gameType: "expansion", parentGameId: main.igdbId }, { date: "2038-09-01" }, [ps5]);
  await add(F.port.slug, F.port.name, { gameType: "port", parentGameId: main.igdbId }, { date: "2038-10-01" }, [sw]);
  await add(F.plain.slug, F.plain.name, {}, { date: F.plain.date }, [ps5]);
}
