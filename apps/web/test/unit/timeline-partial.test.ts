// 時間軸「部分結果」（稀疏條件的掃描上限）：cursor 邊界鍵、chunk 旗標與合併。
import { describe, expect, it } from "vitest";
import { boundaryKey, decodeTimelineCursor, encodeTimelineCursor } from "@/modules/catalog/repository/timeline";
import type { TimelineChunk } from "@/modules/catalog/ui/timeline/types";
import { mergeTimelineChunk } from "@/modules/catalog/ui/timeline/view-model";

describe("部分結果 cursor", () => {
  it("邊界鍵（pr=-1）可 round-trip，after／before 都行", () => {
    for (const dir of ["after", "before"] as const) {
      const c = { dir, key: boundaryKey("2023-06-01") };
      expect(decodeTimelineCursor(encodeTimelineCursor(c))).toEqual(c);
    }
  });

  it("舊版 cursor（沒有任何新欄位）仍可解析", () => {
    const old = Buffer.from(JSON.stringify([1, "a", "2027-04-01", 1, -500, 42, 2])).toString("base64url");
    expect(decodeTimelineCursor(old)).toEqual({ dir: "after", key: { sk: "2027-04-01", pr: 1, np: -500, gameId: 42, st: 2 } });
  });
});

describe("mergeTimelineChunk 的 partial 旗標", () => {
  it("next：旗標取新頁的；prev 方向的旗標保留", () => {
    const existing: TimelineChunk = { groups: [], nextCursor: "N0", prevCursor: "P0", prevPartial: true };
    const g = { key: "day:2026-10-13", kind: "day" as const, periodStart: "2026-10-13", month: "2026-10", monthTitle: "", title: "", cards: [], totalCount: 0, hiddenCount: 0, continuesFromPrev: false, continuesToNext: false };
    const withGroup: TimelineChunk = { ...existing, groups: [g] };
    const a = mergeTimelineChunk(withGroup, { groups: [], nextCursor: "N1", prevCursor: null, nextPartial: true }, "next");
    expect(a).toMatchObject({ nextCursor: "N1", nextPartial: true, prevCursor: "P0", prevPartial: true });
    const b = mergeTimelineChunk(a, { groups: [], nextCursor: null, prevCursor: null }, "next");
    expect(b.nextPartial).toBeUndefined();
    expect(b.prevPartial).toBe(true);
  });

  it("prev：旗標取新頁的；next 方向的旗標保留", () => {
    const g = { key: "day:2026-10-13", kind: "day" as const, periodStart: "2026-10-13", month: "2026-10", monthTitle: "", title: "", cards: [], totalCount: 0, hiddenCount: 0, continuesFromPrev: false, continuesToNext: false };
    const existing: TimelineChunk = { groups: [g], nextCursor: "N", prevCursor: "P0", nextPartial: true, prevPartial: true };
    const m = mergeTimelineChunk(existing, { groups: [], nextCursor: null, prevCursor: "P1" }, "prev");
    expect(m).toMatchObject({ prevCursor: "P1", nextPartial: true });
    expect(m.prevPartial).toBeUndefined();
  });
});
