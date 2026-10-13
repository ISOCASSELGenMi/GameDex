/** 3b K：IGDB 活動名稱 → 類型推斷（純函式）、--reclassify 參數、logo ImageRef。 */
import { describe, expect, it } from "vitest";
import { classifyIgdbEventName, EVENT_KIND_RULES, inferIgdbEventKind } from "@/modules/catalog/providers/igdb/event-kind";
import { igdbImageRef } from "@/modules/catalog/providers/igdb/images";
import { resolveImageRef } from "@/modules/catalog/providers/image-ref";
import { parseSyncEventsArgs } from "@/modules/catalog/use-cases/sync/sync-events";

describe("inferIgdbEventKind", () => {
  const cases: [string, string][] = [
    ["Nintendo Direct 2023.06.21", "showcase"],
    ["PlayStation State of Play", "showcase"],
    ["Pokemon Presents", "showcase"],
    ["Ubisoft Forward 2021", "showcase"],
    ["NetEase Connect 2023", "showcase"],
    ["Nintendo E3 2005 Press Conference", "showcase"],
    ["Women-Led Games Showcase: The Game Awards Edition", "showcase"],
    ["505 Games at Tokyo Game Show 2023", "showcase"],
    ["Capcom Online Program: Tokyo Game Show 2023", "showcase"],
    ["gamescom Opening Night Live 2019", "showcase"],
    ["Indie Live Expo 2023", "showcase"],
    ["Apple Event September 2023", "showcase"],
    ["The Game Awards 2018", "awards"],
    ["17th Unity Awards", "awards"],
    ["Tokyo Game Show 2020", "expo"],
    ["Summer Game Fest 2021", "expo"],
    ["BlizzCon 2023", "expo"],
    ["PAX West 2019", "expo"],
    ["E3 2018", "expo"],
    ["Gamirror Games Now: Tokyo Games Show 2024", "expo"],
    ["Warhammer Skulls 2023", "other"],
    ["Sonic Central", "other"],
    ["", "other"],
  ];
  it.each(cases)("%s → %s", (name, kind) => {
    expect(inferIgdbEventKind(name)).toBe(kind);
  });

  it("不分大小寫；回傳命中的規則代號", () => {
    expect(classifyIgdbEventName("NINTENDO DIRECT")).toEqual({ kind: "showcase", ruleId: "showcase-keyword" });
    expect(classifyIgdbEventName("nothing special")).toEqual({ kind: "other", ruleId: null });
  });

  it("規則代號唯一、類型都在 enum 內", () => {
    const ids = EVENT_KIND_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of EVENT_KIND_RULES) expect(["showcase", "expo", "awards"]).toContain(r.kind);
  });
});

describe("parseSyncEventsArgs", () => {
  it("--reclassify／--all", () => {
    expect(parseSyncEventsArgs([])).toEqual({ reclassify: false, all: false });
    expect(parseSyncEventsArgs(["--reclassify"])).toEqual({ reclassify: true, all: false });
    expect(parseSyncEventsArgs(["--reclassify", "--all"])).toEqual({ reclassify: true, all: true });
  });
});

describe("logo ImageRef", () => {
  const stored = "https://images.igdb.com/igdb/image/upload/t_logo_med/el173.png";
  it("IGDB logo：內縮尺寸、png", () => {
    expect(igdbImageRef(stored, "logo")).toEqual({
      original: stored,
      small: "https://images.igdb.com/igdb/image/upload/t_logo_med/el173.png",
      medium: "https://images.igdb.com/igdb/image/upload/t_logo_med/el173.png",
      large: "https://images.igdb.com/igdb/image/upload/t_720p/el173.png",
      resized: true,
    });
  });
  it("非 IGDB 網址原樣、空值 null；封面仍是 jpg", () => {
    expect(resolveImageRef("https://example.com/l.png", "logo")).toMatchObject({ small: "https://example.com/l.png", resized: false });
    expect(resolveImageRef(null, "logo")).toBeNull();
    expect(igdbImageRef(stored, "cover")?.medium).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/el173.jpg");
  });
});
