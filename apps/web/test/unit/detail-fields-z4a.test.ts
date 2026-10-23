/**
 * Z4A：詳情補欄位的 IGDB 對照、相關內容分組對照、回填任務參數／游標（單元）。
 */
import { describe, expect, it } from "vitest";
import { GAME_TYPES, RELATED_GROUP_KEYS } from "@/modules/catalog";
import { buildGamesWhere, GAME_DETAIL_FIELDS, GAME_FIELDS, toGameRecord } from "@/modules/catalog/providers/igdb";
import {
  gameTypesOfRelatedGroup,
  relatedGroupOfGameType,
  RELATED_GROUP_BY_GAME_TYPE,
} from "@/modules/catalog/domain/related-groups";
import { parseDetailBackfillArgs, parseDetailCursor } from "@/modules/catalog/use-cases/sync/backfill-detail-fields";

describe("toGameRecord：詳情補欄位", () => {
  it("storyline、version、人數、視角、引擎轉成我方型別；空白字串 → null；重複 id 去重", () => {
    const r = toGameRecord({
      id: 1,
      storyline: "  Long story ",
      version_parent: 77,
      version_title: "Deluxe Edition",
      game_modes: [
        { id: 1, name: "Single player", slug: "single-player" },
        { id: 1, name: "Single player", slug: "single-player" },
        { id: 2, name: "Multiplayer", slug: "multiplayer" },
      ],
      player_perspectives: [{ id: 2, name: "Third person", slug: "third-person" }],
      game_engines: [{ id: 26, name: "RAGE", slug: "rage" }],
    });
    expect(r.storyline).toBe("  Long story ");
    expect(r.versionParentIgdbId).toBe(77);
    expect(r.versionTitle).toBe("Deluxe Edition");
    expect(r.gameModes).toEqual([
      { igdbId: 1, name: "Single player", slug: "single-player" },
      { igdbId: 2, name: "Multiplayer", slug: "multiplayer" },
    ]);
    expect(r.playerPerspectives).toEqual([{ igdbId: 2, name: "Third person", slug: "third-person" }]);
    expect(r.engines).toEqual([{ igdbId: 26, name: "RAGE", slug: "rage" }]);
  });

  it("欄位缺少 → null／空陣列", () => {
    const r = toGameRecord({ id: 2, storyline: "   " });
    expect(r).toMatchObject({
      storyline: null,
      versionParentIgdbId: null,
      versionTitle: null,
      gameModes: [],
      playerPerspectives: [],
      engines: [],
    });
  });

  it("GAME_FIELDS 帶全部新欄位；detail 欄位集只有新欄位", () => {
    for (const f of ["storyline", "version_parent", "version_title", "game_modes.slug", "player_perspectives.name", "game_engines.slug"]) {
      expect(GAME_FIELDS.split(",")).toContain(f);
      expect(GAME_DETAIL_FIELDS.split(",")).toContain(f);
    }
    expect(GAME_DETAIL_FIELDS).not.toContain("release_dates");
    expect(GAME_DETAIL_FIELDS.split(",")).toHaveLength(9);
    expect(buildGamesWhere({ ids: [3, 5], limit: 500, fieldSet: "detail" })).toBe("id = (3,5)");
  });
});

describe("相關內容分組對照", () => {
  it("每個 game_type 至多一組；組鍵都在合約內；每個組（editions 除外）都有來源類型", () => {
    for (const [t, k] of Object.entries(RELATED_GROUP_BY_GAME_TYPE)) {
      expect(GAME_TYPES).toContain(t);
      expect(RELATED_GROUP_KEYS).toContain(k);
    }
    expect(RELATED_GROUP_KEYS.filter((k) => k !== "editions" && gameTypesOfRelatedGroup(k).length === 0)).toEqual([]);
  });

  it("對照結果", () => {
    expect(relatedGroupOfGameType("dlc_addon")).toBe("dlcs");
    expect(relatedGroupOfGameType("expanded_game")).toBe("expanded_games");
    expect(relatedGroupOfGameType("season")).toBe("episodes");
    expect(relatedGroupOfGameType("episode")).toBe("episodes");
    expect(relatedGroupOfGameType("mod")).toBe("packs");
    expect(relatedGroupOfGameType("fork")).toBe("packs");
    expect(relatedGroupOfGameType("main_game")).toBeNull();
    expect(relatedGroupOfGameType(null)).toBeNull();
    expect(relatedGroupOfGameType("other")).toBeNull();
    expect(gameTypesOfRelatedGroup("packs").sort()).toEqual(["fork", "mod", "pack", "update"]);
  });
});

describe("backfill_detail_fields 參數與游標", () => {
  it("參數", () => {
    expect(parseDetailBackfillArgs([])).toEqual({});
    expect(parseDetailBackfillArgs(["--max-batches", "3", "--restart"])).toEqual({ maxBatches: 3, restart: true });
    expect(parseDetailBackfillArgs(["--max-batches=2"])).toEqual({ maxBatches: 2 });
    expect(() => parseDetailBackfillArgs(["--max-batches", "0"])).toThrow();
    expect(() => parseDetailBackfillArgs(["--tier", "2"])).toThrow();
  });
  it("游標", () => {
    expect(parseDetailCursor(JSON.stringify({ afterId: 5, done: false, startedAt: "x" }))).toMatchObject({ afterId: 5, done: false });
    expect(parseDetailCursor("not json")).toBeNull();
    expect(parseDetailCursor(JSON.stringify({ afterId: "5" }))).toBeNull();
    expect(parseDetailCursor(null)).toBeNull();
  });
});
