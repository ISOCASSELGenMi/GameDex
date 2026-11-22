/**
 * Metacritic 頁面快取的純函式：TTL（ok 已發售 90 天／ok 未定或未發售 7 天／not_found 30 天／parse_failed 7 天）、PageResult 與資料列互轉。
 */
import { describe, expect, it } from "vitest";
import type { PageResult } from "@/modules/metacritic/provider/provider";
import { PAGE_TTL_DAYS, pageExpiresAt, pageResultFromRow, pageRowFromResult } from "@/modules/metacritic/use-cases/pages";

const at = new Date("2026-11-21T08:00:00Z");
const days = (d: number) => new Date(at.getTime() + d * 86_400_000);

describe("pageExpiresAt：TTL", () => {
  it("ok 且發售日已過 → 90 天", () => expect(pageExpiresAt("ok", "2026-11-20", at)).toEqual(days(90)));
  it("ok 但發售日是今天、未來或未定 → 7 天", () => {
    expect(pageExpiresAt("ok", "2026-11-21", at)).toEqual(days(7));
    expect(pageExpiresAt("ok", "2027-01-01", at)).toEqual(days(7));
    expect(pageExpiresAt("ok", null, at)).toEqual(days(7));
  });
  it("not_found 30 天、parse_failed 7 天（與發售日無關）", () => {
    expect(pageExpiresAt("not_found", null, at)).toEqual(days(30));
    expect(pageExpiresAt("parse_failed", "2020-01-01", at)).toEqual(days(7));
    expect(PAGE_TTL_DAYS).toEqual({ okReleased: 90, okOpen: 7, notFound: 30, parseFailed: 7 });
  });
});

describe("PageResult ↔ 資料列", () => {
  const ok: PageResult = {
    kind: "ok",
    title: "Fixture Quest",
    year: 2017,
    facts: { title: "Fixture Quest", releaseDate: "2017-03-03", companies: ["Acme", "Pub"], platforms: ["PC", "Switch"] },
    scores: [
      { scoreType: "metascore", score: 97, scoreMax: 100, reviewCount: 109 },
      { scoreType: "user_score", score: 89, scoreMax: 100, reviewCount: 27453 },
    ],
  };
  const asRow = (r: ReturnType<typeof pageRowFromResult>) => ({ ...r, title: r.title ?? null, releaseDate: r.releaseDate ?? null, releaseYear: r.releaseYear ?? null, companies: r.companies ?? [], platforms: r.platforms ?? [], metascore: r.metascore ?? null, metascoreCount: r.metascoreCount ?? null, userscore: r.userscore ?? null, userscoreCount: r.userscoreCount ?? null });
  it("ok 來回一致（含分數與評論數）", () => {
    const row = pageRowFromResult("fixture-quest", ok, at);
    expect(row).toMatchObject({ slug: "fixture-quest", state: "ok", metascore: 97, userscore: 89, expiresAt: days(90) });
    expect(pageResultFromRow(asRow(row) as never)).toEqual(ok);
  });
  it("沒有分數（tbd）也能還原；not_found／parse_failed（status 還原為 0）", () => {
    const tbd: PageResult = { ...ok, scores: [] };
    expect(pageResultFromRow(asRow(pageRowFromResult("x", tbd, at)) as never)).toEqual(tbd);
    expect(pageResultFromRow(asRow(pageRowFromResult("x", { kind: "not_found" }, at)) as never)).toEqual({ kind: "not_found" });
    expect(pageResultFromRow(asRow(pageRowFromResult("x", { kind: "parse_failed", status: 200 }, at)) as never)).toEqual({ kind: "parse_failed", status: 0 });
  });
});
