/**
 * Phase 3b（H）遊戲詳情補完：語言支援三態（整合）。igdbId 85xxxx、slug 前綴 h3d-。
 * languages 可能已被其他測試檔寫入：依 code 取或建。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getGameDetail } from "@/modules/catalog/use-cases/read/get-game-detail";
import { gameLanguageSupports, games, languages } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const lang: Record<string, number> = {};

async function addGame(igdbId: number, support: Array<[string, "interface" | "subtitles" | "audio"]>) {
  const db = getDb();
  const [g] = await db.insert(games).values({ igdbId, slug: `h3d-${igdbId}`, name: `H3D ${igdbId}` }).returning({ id: games.id });
  for (const [code, supportType] of support) await db.insert(gameLanguageSupports).values({ gameId: g.id, languageId: lang[code], supportType });
}

describe.skipIf(!enabled)("遊戲詳情：語言支援（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const codes = ["en-US", "ja-JP", "zh-Hant", "zh-Hans"];
    await db
      .insert(languages)
      .values(codes.map((code) => ({ code, name: code })))
      .onConflictDoNothing();
    for (const r of await db.select().from(languages).where(inArray(languages.code, codes))) lang[r.code] = r.id;
    await addGame(850001, [
      ["en-US", "interface"], ["en-US", "audio"], ["ja-JP", "interface"], ["zh-Hant", "interface"], ["zh-Hans", "interface"],
    ]);
    await addGame(850002, []);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("有資料：只列有資料的語言、網站語言置頂、字幕欄 no_data", async () => {
    const d = await getGameDetail({ slug: "h3d-850001", locale: "zh-Hant" });
    const s = d!.languageSupport;
    expect(s.status).toBe("available");
    expect(s.columns).toEqual({ interface: "has_data", subtitles: "no_data", audio: "has_data" });
    expect(s.rows).toEqual([
      { languageCode: "zh-Hant", types: ["interface"] },
      { languageCode: "en-US", types: ["interface", "audio"] },
      { languageCode: "ja-JP", types: ["interface"] },
      { languageCode: "zh-Hans", types: ["interface"] },
    ]);
    const ja = await getGameDetail({ slug: "h3d-850001", locale: "ja" });
    expect(ja!.languageSupport.rows[0].languageCode).toBe("ja-JP");
  });

  it("完全沒資料 → 整區 no_data（尚無語言資料），三欄 no_data", async () => {
    const d = await getGameDetail({ slug: "h3d-850002", locale: "en" });
    expect(d!.languageSupport).toEqual({
      status: "no_data",
      columns: { interface: "no_data", subtitles: "no_data", audio: "no_data" },
      rows: [],
    });
  });
});
