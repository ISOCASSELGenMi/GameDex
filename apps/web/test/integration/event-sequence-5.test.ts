/**
 * Phase 5 收尾：events.sequence 與 updated_at 抖動（08 §活動 SEQUENCE、03 events）。
 * 同步同一份資料兩次不動 updated_at／ETag／ics；開始或結束時間變動 → sequence +1＋change_feed 一筆；只改名稱 → 只更新 updated_at。
 * igdbId 975xxx、slug 前綴 ical5e-；「今天」固定 2037-06-01。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { syncIgdbEvent } from "@/modules/catalog/repository/events";
import { prepareIcalFeed } from "@/modules/catalog/use-cases/ical";
import { events } from "@/modules/catalog/schema";
import type { EventRecord } from "@/modules/catalog";
import { parseIcs } from "../helpers/ics";

const enabled = !!process.env.TEST_DATABASE_URL;
const TODAY = "2037-06-01";
const LINKS = { game: (s: string) => `https://x.test/en/games/${s}`, event: (s: string) => `https://x.test/en/events/${s}` };

const rec = (over: Partial<EventRecord> = {}): EventRecord => ({
  igdbId: 975001,
  name: "Ical5E Showcase",
  kind: "other",
  slug: "ical5e-showcase",
  description: null,
  startTime: new Date("2037-07-01T10:00:00Z"),
  endTime: new Date("2037-07-01T12:00:00Z"),
  timeZone: "PST",
  logoUrl: null,
  streamUrl: null,
  gameIgdbIds: [1, 2],
  sourceUpdatedAt: null,
  ...over,
});

describe.skipIf(!enabled)("events.sequence（整合）", () => {
  afterAll(async () => {
    await closeDb();
  });

  const row = async (igdbId: number) => (await getDb().select().from(events).where(eq(events.igdbEventId, igdbId)))[0];
  const feedRows = async (id: number) =>
    (await getDb().execute<{ change_type: string }>(sql`SELECT change_type FROM change_feed WHERE entity_type = 'event' AND entity_id = ${id} ORDER BY id`)).rows.map((r) => r.change_type);
  async function render() {
    const feed = (await prepareIcalFeed({ spec: { kind: "events" }, locale: "en", links: LINKS, today: TODAY }))!;
    const ics = await feed.render();
    const ev = parseIcs(ics).events.find((e) => e.get("UID") === `event-${id}@sok.local`) ?? parseIcs(ics).events.find((e) => /ical5e-showcase/.test(e.get("URL") ?? ""))!;
    return { etag: feed.etag, ics, ev };
  }
  let id = 0;

  it("重複同步：updated_at、ETag、ics 位元組不變；改時間 → sequence +1；只改名稱 → sequence 不變", async () => {
    const first = await syncIgdbEvent(rec());
    expect(first.inserted).toBe(true);
    id = first.eventId!;
    const r0 = await row(975001);
    expect(r0.sequence).toBe(0);
    const base = await render();
    expect(base.ev.get("SEQUENCE")).toBe("0");

    await new Promise((r) => setTimeout(r, 20));
    const again = await syncIgdbEvent(rec());
    expect(again).toMatchObject({ inserted: false, startTimeChanged: false });
    const r1 = await row(975001);
    expect(r1.updatedAt?.getTime()).toBe(r0.updatedAt?.getTime());
    const same = await render();
    expect(same.etag).toBe(base.etag);
    expect(same.ics).toBe(base.ics);
    expect(await feedRows(id)).toEqual(["created"]);

    // 只改名稱：updated_at 變、sequence 不變、無 date_changed
    await syncIgdbEvent(rec({ name: "Ical5E Showcase (renamed)" }));
    const r2 = await row(975001);
    expect(r2.sequence).toBe(0);
    expect(r2.updatedAt!.getTime()).toBeGreaterThan(r0.updatedAt!.getTime());
    expect(await feedRows(id)).toEqual(["created"]);
    const renamed = await render();
    expect(renamed.etag).not.toBe(base.etag);
    expect(renamed.ev.get("SEQUENCE")).toBe("0");

    // 改開始時間
    const res = await syncIgdbEvent(rec({ name: "Ical5E Showcase (renamed)", startTime: new Date("2037-07-02T10:00:00Z") }));
    expect(res.startTimeChanged).toBe(true);
    const r3 = await row(975001);
    expect(r3.sequence).toBe(1);
    expect(await feedRows(id)).toEqual(["created", "date_changed"]);
    const moved = await render();
    expect(moved.ev.get("SEQUENCE")).toBe("1");
    expect(moved.ev.get("DTSTART")).toBe("20370702T100000Z");

    // 只改結束時間：同樣 +1、一筆 date_changed
    await syncIgdbEvent(rec({ name: "Ical5E Showcase (renamed)", startTime: new Date("2037-07-02T10:00:00Z"), endTime: new Date("2037-07-02T14:00:00Z") }));
    expect((await row(975001)).sequence).toBe(2);
    expect(await feedRows(id)).toEqual(["created", "date_changed", "date_changed"]);
    expect((await render()).ev.get("SEQUENCE")).toBe("2");

    // 再同步一次相同資料：不變
    const stable = await render();
    await syncIgdbEvent(rec({ name: "Ical5E Showcase (renamed)", startTime: new Date("2037-07-02T10:00:00Z"), endTime: new Date("2037-07-02T14:00:00Z") }));
    expect((await render()).etag).toBe(stable.etag);
  });

  it("人工標註的 kind 不被覆蓋，且 kind 沒變不算變動", async () => {
    await syncIgdbEvent(rec({ igdbId: 975002, slug: "ical5e-kind", name: "Ical5E Kind", kind: "expo" }));
    const a = await row(975002);
    await getDb().update(events).set({ kind: "awards" }).where(eq(events.id, a.id));
    const b0 = await row(975002);
    await new Promise((r) => setTimeout(r, 20));
    await syncIgdbEvent(rec({ igdbId: 975002, slug: "ical5e-kind", name: "Ical5E Kind", kind: "expo" }));
    const b = await row(975002);
    expect(b.kind).toBe("awards");
    expect(b.updatedAt?.getTime()).toBe(b0.updatedAt?.getTime());
  });

  it("migration 回填：sequence＝date_changed 筆數", async () => {
    const db = getDb();
    const [e] = await db.insert(events).values({ slug: "ical5e-backfill", name: "Ical5E Backfill", igdbEventId: 975003 }).returning({ id: events.id });
    for (const t of ["created", "date_changed", "date_changed", "date_changed"]) {
      await db.execute(sql`INSERT INTO change_feed (entity_type, entity_id, change_type) VALUES ('event', ${e.id}, ${t})`);
    }
    expect((await row(975003)).sequence).toBe(0);
    const file = readdirSql();
    const stmt = file.split("--> statement-breakpoint").map((s) => s.trim()).find((s) => s.startsWith("UPDATE"))!;
    await db.execute(sql.raw(stmt));
    expect((await row(975003)).sequence).toBe(3);
    // 沒有 date_changed 的活動不受影響
    expect((await row(975002)).sequence).toBe(0);
  });
});

function readdirSql(): string {
  const dir = resolve(__dirname, "../../drizzle");
  const name = readFileSync(resolve(dir, "meta/_journal.json"), "utf8");
  const tag = (JSON.parse(name).entries as { tag: string }[]).map((e) => e.tag).find((t) => /^0005_/.test(t))!;
  return readFileSync(resolve(dir, `${tag}.sql`), "utf8");
}
