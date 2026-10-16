/** Phase 7 第 5 波（畫面補的後端）：GET /imports/steam 的 ?status= 篩選（伺服器端，與 ownedGameStatus 的判定一致）。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { connectedAccounts, ownedGames, users } from "@/modules/accounts/schema";
import { OWNED_GAME_STATUSES, ownedGameStatus } from "@/modules/accounts/domain/entities/owned-game";
import { listOwnedGameRows } from "@/modules/accounts/repository/owned-games";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("owned_games ?status= 篩選", () => {
  let accountId = 0;

  beforeAll(async () => {
    const [u] = await getDb().insert(users).values({ email: "q5-filter@example.com", displayName: "Q5 Filter" }).returning({ id: users.id });
    const [a] = await getDb().insert(connectedAccounts).values({ userId: u!.id, provider: "steam", providerAccountId: "76561198000088001" }).returning({ id: connectedAccounts.id });
    accountId = a!.id;
    // 不需要真實遊戲：matched 用 NULL 以外的值會碰 FK，所以 matched 另用「已存在的遊戲」；這裡先塞其他四種，matched 於下方補
    const rows = [
      { externalGameId: "1", externalTitle: "Queued", matchedGameId: null, matchConfidencePct: null, matchMethod: "auto" },
      { externalGameId: "2", externalTitle: "Review", matchedGameId: null, matchConfidencePct: 70, matchMethod: "auto" },
      { externalGameId: "3", externalTitle: "NotFound", matchedGameId: null, matchConfidencePct: 0, matchMethod: "auto" },
      { externalGameId: "4", externalTitle: "Dismissed", matchedGameId: null, matchConfidencePct: 0, matchMethod: "manual" },
    ];
    for (const r of rows) await getDb().insert(ownedGames).values({ connectedAccountId: accountId, ...r });
  });
  afterAll(async () => {
    await getDb().delete(users).where(like(users.email, "q5-filter%"));
    await closeDb();
  });

  it("每個狀態只回該狀態的列，且與 ownedGameStatus 判定一致；省略＝全部", async () => {
    const all = await listOwnedGameRows(accountId, 50, 0);
    expect(all.rows.map((r) => r.externalTitle).sort()).toEqual(["Dismissed", "NotFound", "Queued", "Review"]);
    const expected: Record<string, string> = { queued: "Queued", needs_review: "Review", not_found: "NotFound", dismissed: "Dismissed" };
    for (const status of OWNED_GAME_STATUSES) {
      const { rows } = await listOwnedGameRows(accountId, 50, 0, status);
      if (status === "matched") {
        expect(rows).toEqual([]);
        continue;
      }
      expect(rows.map((r) => r.externalTitle), status).toEqual([expected[status]]);
      expect(ownedGameStatus(rows[0]!), status).toBe(status);
    }
  });

  it("篩選後的分頁：limit／offset／hasMore", async () => {
    await getDb().insert(ownedGames).values([
      { connectedAccountId: accountId, externalGameId: "5", externalTitle: "NotFound B", matchConfidencePct: 0, matchMethod: "auto" },
      { connectedAccountId: accountId, externalGameId: "6", externalTitle: "NotFound C", matchConfidencePct: 0, matchMethod: "auto" },
    ]);
    const p1 = await listOwnedGameRows(accountId, 2, 0, "not_found");
    expect(p1.rows.map((r) => r.externalTitle)).toEqual(["NotFound", "NotFound B"]);
    expect(p1.hasMore).toBe(true);
    const p2 = await listOwnedGameRows(accountId, 2, 2, "not_found");
    expect(p2.rows.map((r) => r.externalTitle)).toEqual(["NotFound C"]);
    expect(p2.hasMore).toBe(false);
    await getDb().delete(ownedGames).where(eq(ownedGames.connectedAccountId, accountId));
  });
});
