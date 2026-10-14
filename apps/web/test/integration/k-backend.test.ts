/** 3b K：活動重新分類（Repository）、logo 經 ImageResolver。events 名稱前綴 K3B、igdb id 84xxxx。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { inferIgdbEventKind } from "@/modules/catalog/providers/igdb/event-kind";
import { events } from "@/modules/catalog/schema";
import { listEvents } from "@/modules/catalog/use-cases/read/list-events";
import { reclassifyEventKinds } from "@/modules/catalog/use-cases/sync/sync-events";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};

describe.skipIf(!enabled)("K 後端（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.delete(events).where(like(events.name, "K3B %"));
    await db.insert(events).values([
      { igdbEventId: 840001, name: "K3B Nintendo Direct", slug: "k3b-1", source: "igdb", kind: "other", logoUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/k3blogo.png" },
      { igdbEventId: 840002, name: "K3B Tokyo Game Show 2099", slug: "k3b-2", source: "igdb", kind: "showcase" }, // 管理員標過
      { igdbEventId: 840003, name: "K3B Plain Gathering", slug: "k3b-3", source: "igdb", kind: "other" },
      { name: "K3B Manual Direct", slug: "k3b-4", source: "manual", kind: "other" },
    ]);
  });
  afterAll(async () => {
    await getDb().delete(events).where(like(events.name, "K3B %"));
    await closeDb();
  });

  const kindOf = async (slug: string) => (await getDb().select({ k: events.kind }).from(events).where(eq(events.slug, slug)))[0].k;

  it("預設只改 other 的 IGDB 活動；人工活動與已標註的不動", async () => {
    const res = await reclassifyEventKinds({ log: noLog });
    expect(res.changed.showcase).toBeGreaterThanOrEqual(1);
    expect(await kindOf("k3b-1")).toBe("showcase");
    expect(await kindOf("k3b-2")).toBe("showcase");
    expect(await kindOf("k3b-3")).toBe("other");
    expect(await kindOf("k3b-4")).toBe("other");
  });

  it("--all：已標註的 IGDB 活動也依規則重算；人工仍不動", async () => {
    await reclassifyEventKinds({ log: noLog }, { all: true });
    expect(await kindOf("k3b-2")).toBe(inferIgdbEventKind("K3B Tokyo Game Show 2099"));
    expect(await kindOf("k3b-2")).toBe("expo");
    expect(await kindOf("k3b-4")).toBe("other");
  });

  it("活動列表的 logo 是 ImageRef（kind＝logo），舊 logoUrl 保留", async () => {
    const list = await listEvents({ scope: "undated", pageSize: 100 });
    const it1 = list.items.find((i) => i.slug === "k3b-1");
    expect(it1?.logo?.large).toBe("https://images.igdb.com/igdb/image/upload/t_720p/k3blogo.png");
    expect(it1?.logoUrl).toBe(it1?.logo?.original);
  });
});
