/**
 * Phase 3b（H）活動列表與詳情（整合）。igdbId／slug 前綴 h3e-、時間用 2042 年（以 now 參數固定「現在」）。
 * 其他測試檔的活動也在同一個 DB：斷言只看 h3e- 開頭的項目。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import type { EventListItem } from "@/modules/catalog/domain/entities";
import { getEventDetail } from "@/modules/catalog/use-cases/read/get-event-detail";
import { listEvents } from "@/modules/catalog/use-cases/read/list-events";
import { eventGames, eventSeries, events, games } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const NOW = new Date("2042-03-10T12:00:00Z");
const mine = (items: EventListItem[]) => items.filter((e) => e.slug.startsWith("h3e-")).map((e) => e.slug);

describe.skipIf(!enabled)("活動列表與詳情（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [series] = await db.insert(eventSeries).values({ name: "H3E Show", slug: "h3e-show", kind: "showcase" }).returning({ id: eventSeries.id });
    const ev = async (slug: string, v: Partial<typeof events.$inferInsert>) => {
      const [row] = await db.insert(events).values({ name: slug.toUpperCase(), slug, ...v }).returning({ id: events.id });
      return row.id;
    };
    // 2042-03-10 12:00Z 為「現在」
    await ev("h3e-future-b", { kind: "showcase", startTime: new Date("2042-04-01T18:00:00Z"), seriesId: series.id });
    await ev("h3e-future-a", { kind: "expo", startTime: new Date("2042-03-20T18:00:00Z"), endTime: new Date("2042-03-22T18:00:00Z") });
    // 進行中的多日展會：開始已過、結束未到 → 仍在 upcoming
    await ev("h3e-ongoing", { kind: "expo", startTime: new Date("2042-03-08T00:00:00Z"), endTime: new Date("2042-03-12T00:00:00Z") });
    const pastId = await ev("h3e-past", {
      kind: "showcase",
      startTime: new Date("2042-02-01T18:00:00Z"),
      endTime: new Date("2042-02-01T19:00:00Z"),
      seriesId: series.id,
      streamUrl: "https://example.com/live",
      url: "https://example.com",
      organizer: "H3E Org",
      description: "desc",
      timezone: "PST",
    });
    await ev("h3e-older", { kind: "awards", startTime: new Date("2041-02-01T18:00:00Z"), seriesId: series.id });
    await ev("h3e-undated", { kind: "other", startTime: null, seriesId: series.id });

    for (const [i, pop] of [10, 500, 200].entries()) {
      const [g] = await db
        .insert(games)
        .values({ igdbId: 840001 + i, slug: `h3e-g${i}`, name: `H3E G${i}`, popularityScore: pop, gameType: "main_game" })
        .returning({ id: games.id });
      await db.insert(eventGames).values({ eventId: pastId, gameId: g.id });
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  it("upcoming：COALESCE(end, start) ≥ now，含進行中，開始時間舊到新", async () => {
    const list = await listEvents({ now: NOW, pageSize: 100 });
    expect(list.scope).toBe("upcoming");
    expect(list.kind).toBeNull();
    expect(mine(list.items)).toEqual(["h3e-ongoing", "h3e-future-a", "h3e-future-b"]);
    const st = Object.fromEntries(list.items.map((e) => [e.slug, e.timeStatus]));
    expect(st["h3e-ongoing"]).toBe("ongoing");
    expect(st["h3e-future-a"]).toBe("upcoming");
  });

  it("past：新到舊；undated：start NULL；類型篩選、未知類型＝全部", async () => {
    expect(mine((await listEvents({ now: NOW, scope: "past", pageSize: 100 })).items)).toEqual(["h3e-past", "h3e-older"]);
    const und = await listEvents({ now: NOW, scope: "undated", pageSize: 100 });
    expect(mine(und.items)).toEqual(["h3e-undated"]);
    expect(und.items.find((e) => e.slug === "h3e-undated")!.timeStatus).toBe("undated");
    const expo = await listEvents({ now: NOW, type: "expo", pageSize: 100 });
    expect(expo.kind).toBe("expo");
    expect(mine(expo.items)).toEqual(["h3e-ongoing", "h3e-future-a"]);
    expect((await listEvents({ now: NOW, type: "nope" })).kind).toBeNull();
  });

  it("分頁：page／pageSize、hasMore", async () => {
    const p1 = await listEvents({ now: NOW, type: "expo", pageSize: 1 });
    const p2 = await listEvents({ now: NOW, type: "expo", pageSize: 1, page: 2 });
    expect(p1.hasMore).toBe(true);
    expect([...p1.items, ...p2.items].map((e) => e.slug)).toEqual(["h3e-ongoing", "h3e-future-a"]);
    expect((await listEvents({ page: 0, pageSize: 0, now: NOW })).page).toBe(1);
  });

  it("getEventDetail：欄位、相關遊戲依熱度、同系列歷屆（新到舊、未定最後、不含本屆）", async () => {
    const d = await getEventDetail({ slug: "h3e-past", locale: "en", now: NOW });
    expect(d).toMatchObject({
      slug: "h3e-past",
      kind: "showcase",
      timeStatus: "past",
      startTime: "2042-02-01T18:00:00.000Z",
      endTime: "2042-02-01T19:00:00.000Z",
      timezone: "PST",
      streamUrl: "https://example.com/live",
      url: "https://example.com",
      organizer: "H3E Org",
      description: "desc",
      gameCount: 3,
      series: { slug: "h3e-show", name: "H3E Show", kind: "showcase" },
    });
    expect(d!.games.map((g) => g.slug)).toEqual(["h3e-g1", "h3e-g2", "h3e-g0"]);
    expect(d!.seriesEvents.map((e) => e.slug)).toEqual(["h3e-future-b", "h3e-older", "h3e-undated"]);
  });

  it("getEventDetail：時間未定、無系列、不存在 → null", async () => {
    const u = await getEventDetail({ slug: "h3e-undated", locale: "en", now: NOW });
    expect(u!.startTime).toBeNull();
    expect(u!.timeStatus).toBe("undated");
    const a = await getEventDetail({ slug: "h3e-future-a", locale: "en", now: NOW });
    expect(a!.series).toBeNull();
    expect(a!.seriesEvents).toEqual([]);
    expect(a!.games).toEqual([]);
    expect(await getEventDetail({ slug: "h3e-nope", locale: "en" })).toBeNull();
  });
});
