/** Phase 7 第 5 波單元測試：清單／遊玩紀錄驗證規則、評分換算、ownedGameStatus、玩家平均門檻。 */
import { describe, expect, it } from "vitest";
import {
  mergeOrder,
  parseIdParam,
  validateIdOrder,
  validateListCreate,
  validateListNote,
  validateListPatch,
} from "@/modules/accounts/domain/entities/lists";
import {
  averageHalfStepsToScore,
  datesOrdered,
  halfStepsToScore,
  isValidIsoDate,
  toPublicPlayRecord,
  validatePlayRecordCreate,
  validatePlayRecordPatch,
  type PlayRecordView,
} from "@/modules/accounts/domain/entities/play-records";
import { PLAYER_RATING_MIN_COUNT_DEFAULT, resolvePlayerRatingMinCount } from "@/modules/accounts/domain/entities/player-rating";
import { ownedGameStatus } from "@/modules/accounts/domain/entities/owned-game";

describe("清單驗證", () => {
  it("建立：name 必填、trim、上限 100；description 空字串＝null；visibility 只收三值", () => {
    expect(validateListCreate({ name: "  想玩  " })).toEqual({ ok: true, value: { name: "想玩", description: null, visibility: undefined } });
    expect(validateListCreate({ name: "a", description: "  ", visibility: "unlisted" })).toMatchObject({ ok: true, value: { description: null, visibility: "unlisted" } });
    expect(validateListCreate({})).toEqual({ ok: false, fields: { name: "required" } });
    expect(validateListCreate({ name: "   " })).toEqual({ ok: false, fields: { name: "required" } });
    expect(validateListCreate({ name: "x".repeat(101) })).toEqual({ ok: false, fields: { name: "too_long" } });
    expect(validateListCreate({ name: "a", visibility: "friends" })).toEqual({ ok: false, fields: { visibility: "invalid" } });
    expect(validateListCreate("x")).toEqual({ ok: false, fields: { body: "invalid" } });
  });
  it("PATCH：至少一個欄位；description null 清除；rotateShareToken 要是 boolean", () => {
    expect(validateListPatch({})).toEqual({ ok: false, fields: { body: "empty" } });
    expect(validateListPatch({ description: null })).toEqual({ ok: true, value: { description: null } });
    expect(validateListPatch({ name: null })).toEqual({ ok: false, fields: { name: "required" } });
    expect(validateListPatch({ rotateShareToken: "y" })).toEqual({ ok: false, fields: { rotateShareToken: "invalid" } });
  });
  it("備註：PATCH 必填（null／空字串＝清除）；POST 可省略", () => {
    expect(validateListNote({ note: " hi " }, { required: true })).toEqual({ ok: true, value: { note: "hi" } });
    expect(validateListNote({ note: "" }, { required: true })).toEqual({ ok: true, value: { note: null } });
    expect(validateListNote(undefined, { required: true })).toEqual({ ok: false, fields: { note: "required" } });
    expect(validateListNote(undefined, { required: false })).toEqual({ ok: true, value: { note: undefined } });
    expect(validateListNote({ note: "x".repeat(501) }, { required: false })).toEqual({ ok: false, fields: { note: "too_long" } });
  });
  it("排序 body：整數、不重複、上限；mergeOrder 把指定的排前面其餘保持相對順序", () => {
    expect(validateIdOrder({ gameIds: [3, 1] }, "gameIds", 10)).toEqual({ ok: true, value: [3, 1] });
    expect(validateIdOrder({ gameIds: [1, 1] }, "gameIds", 10)).toEqual({ ok: false, fields: { gameIds: "duplicate" } });
    expect(validateIdOrder({ gameIds: [1, "2"] }, "gameIds", 10)).toEqual({ ok: false, fields: { gameIds: "invalid" } });
    expect(validateIdOrder({ gameIds: [1, 2, 3] }, "gameIds", 2)).toEqual({ ok: false, fields: { gameIds: "too_many" } });
    expect(validateIdOrder({}, "gameIds", 2)).toEqual({ ok: false, fields: { gameIds: "required" } });
    expect(mergeOrder([1, 2, 3, 4], [3, 1])).toEqual([3, 1, 2, 4]);
  });
  it("parseIdParam", () => {
    expect(parseIdParam("12")).toBe(12);
    for (const bad of ["0", "-1", "1.5", "abc", "99999999999", "", "1e3"]) expect(parseIdParam(bad)).toBeNull();
  });
});

describe("遊玩紀錄驗證", () => {
  const base = { gameId: 5, status: "playing" };
  it("建立：gameId、status 必填；其餘預設", () => {
    expect(validatePlayRecordCreate({})).toEqual({ ok: false, fields: { gameId: "required", status: "required" } });
    const ok = validatePlayRecordCreate(base);
    expect(ok).toMatchObject({ ok: true, value: { gameId: 5, status: "playing", platformId: null, ratingHalfSteps: null, reviewHasSpoilers: false, reviewVisibility: undefined } });
    expect(validatePlayRecordCreate({ ...base, status: "won" })).toEqual({ ok: false, fields: { status: "invalid" } });
  });
  it("六種狀態都接受", () => {
    for (const status of ["want_to_play", "playing", "finished", "completed", "paused", "abandoned"]) {
      expect(validatePlayRecordCreate({ gameId: 1, status }).ok).toBe(true);
    }
  });
  it("評分：1~20 整數；0、21、0.5、字串都不行", () => {
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: 1 }).ok).toBe(true);
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: 20 }).ok).toBe(true);
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: 0 })).toEqual({ ok: false, fields: { ratingHalfSteps: "out_of_range" } });
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: 21 })).toEqual({ ok: false, fields: { ratingHalfSteps: "out_of_range" } });
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: 0.5 }).ok).toBe(false);
    expect(validatePlayRecordCreate({ ...base, ratingHalfSteps: "10" })).toEqual({ ok: false, fields: { ratingHalfSteps: "invalid" } });
  });
  it("耗時：0~600000 整數", () => {
    expect(validatePlayRecordCreate({ ...base, playMinutes: 0 }).ok).toBe(true);
    expect(validatePlayRecordCreate({ ...base, playMinutes: -1 })).toEqual({ ok: false, fields: { playMinutes: "out_of_range" } });
    expect(validatePlayRecordCreate({ ...base, playMinutes: 600_001 })).toEqual({ ok: false, fields: { playMinutes: "out_of_range" } });
    expect(validatePlayRecordCreate({ ...base, playMinutes: 1.5 }).ok).toBe(false);
  });
  it("日期：要是真實日期；完成日不得早於開始日", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("26-01-01")).toBe(false);
    expect(validatePlayRecordCreate({ ...base, startedOn: "2026-05-02", finishedOn: "2026-05-01" })).toEqual({ ok: false, fields: { finishedOn: "before_started_on" } });
    expect(validatePlayRecordCreate({ ...base, startedOn: "2026-05-01", finishedOn: "2026-05-01" }).ok).toBe(true);
    expect(validatePlayRecordCreate({ ...base, startedOn: "2026-5-1" })).toEqual({ ok: false, fields: { startedOn: "invalid" } });
    expect(datesOrdered(null, "2026-01-01")).toBe(true);
  });
  it("評論／筆記長度與可見度", () => {
    expect(validatePlayRecordCreate({ ...base, review: "x".repeat(10_001) })).toEqual({ ok: false, fields: { review: "too_long" } });
    expect(validatePlayRecordCreate({ ...base, privateNote: "x".repeat(5_001) })).toEqual({ ok: false, fields: { privateNote: "too_long" } });
    expect(validatePlayRecordCreate({ ...base, reviewVisibility: "friends" })).toEqual({ ok: false, fields: { reviewVisibility: "invalid" } });
    expect(validatePlayRecordCreate({ ...base, reviewVisibility: "followers", reviewHasSpoilers: true })).toMatchObject({ ok: true, value: { reviewVisibility: "followers", reviewHasSpoilers: true } });
  });
  it("PATCH：gameId 不可改；status 不可為 null；null 清除可空欄位", () => {
    expect(validatePlayRecordPatch({ gameId: 9 })).toEqual({ ok: false, fields: { gameId: "immutable" } });
    expect(validatePlayRecordPatch({ status: null })).toEqual({ ok: false, fields: { status: "invalid" } });
    expect(validatePlayRecordPatch({ ratingHalfSteps: null, platformId: null })).toEqual({ ok: true, value: { ratingHalfSteps: null, platformId: null } });
    expect(validatePlayRecordPatch({})).toEqual({ ok: false, fields: { body: "empty" } });
  });
  it("評分換算與玩家平均門檻", () => {
    expect(halfStepsToScore(1)).toBe(0.5);
    expect(halfStepsToScore(17)).toBe(8.5);
    expect(halfStepsToScore(null)).toBeNull();
    expect(averageHalfStepsToScore(16.33)).toBe(8.2);
    expect(averageHalfStepsToScore(20)).toBe(10);
    expect(resolvePlayerRatingMinCount(undefined)).toBe(PLAYER_RATING_MIN_COUNT_DEFAULT);
    expect(resolvePlayerRatingMinCount("3")).toBe(3);
    expect(resolvePlayerRatingMinCount("0")).toBe(5);
    expect(resolvePlayerRatingMinCount("abc")).toBe(5);
  });
  it("toPublicPlayRecord 不含 privateNote", () => {
    const v = { id: 1, privateNote: "secret", review: "ok" } as unknown as PlayRecordView;
    const pub = toPublicPlayRecord(v);
    expect("privateNote" in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("secret");
  });
});

describe("ownedGameStatus（含手動否決）", () => {
  it("狀態判定", () => {
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: null })).toBe("queued");
    expect(ownedGameStatus({ matchedGameId: 1, matchConfidencePct: 90 })).toBe("matched");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 70 })).toBe("needs_review");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 0 })).toBe("not_found");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "auto" })).toBe("not_found");
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 0, matchMethod: "manual" })).toBe("dismissed");
    expect(ownedGameStatus({ matchedGameId: 3, matchConfidencePct: 100, matchMethod: "manual" })).toBe("matched");
    // 手動指定的遊戲被刪（FK SET NULL）→ 請使用者重新指定
    expect(ownedGameStatus({ matchedGameId: null, matchConfidencePct: 100, matchMethod: "manual" })).toBe("needs_review");
  });
});
