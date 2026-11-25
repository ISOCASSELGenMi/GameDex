/**
 * 遊戲頁快取（05 §頁面快取）：包住 provider.getScoreById 的單一出口。
 * - 讀穿：有未過期的列就直接還原成 PageResult，不發請求、不扣額度。
 * - 寫穿：實際發請求後，ok／not_found／parse_failed 都寫入，過期時間依 PAGE_TTL_DAYS。
 * - forceRefresh（sync_ratings：分數到了更新時間）：略過讀取、重抓並更新；重抓解析失敗時不蓋掉既有的 ok／not_found 列。
 * parse_failed 還原時 status 一律為 0（呼叫端只看 kind，不存原始 HTTP 狀態）。
 */
import type { ExternalScore } from "@/modules/catalog";
import { getPage, getPagesBySlugs, upsertPage, type PageRow, type PageRowInput } from "../repository/pages";
import { SLUG_PATTERN, type MetacriticProvider, type PageResult } from "../provider/provider";

export const PAGE_STATES = ["ok", "not_found", "parse_failed"] as const;
export type PageState = (typeof PAGE_STATES)[number];

/** TTL（天）：ok 且發售日已過＝長；ok 但發售日未定或未到＝短（分數與日期還會變）。 */
export const PAGE_TTL_DAYS = { okReleased: 90, okOpen: 7, notFound: 30, parseFailed: 7 } as const;
const DAY_MS = 86_400_000;

export function pageExpiresAt(state: PageState, releaseDate: string | null, fetchedAt: Date): Date {
  const released = state === "ok" && releaseDate !== null && releaseDate < fetchedAt.toISOString().slice(0, 10);
  const days = state === "not_found" ? PAGE_TTL_DAYS.notFound : state === "parse_failed" ? PAGE_TTL_DAYS.parseFailed : released ? PAGE_TTL_DAYS.okReleased : PAGE_TTL_DAYS.okOpen;
  return new Date(fetchedAt.getTime() + days * DAY_MS);
}

const scoreOf = (scores: readonly ExternalScore[], type: string) => scores.find((s) => s.scoreType === type);

export function pageRowFromResult(slug: string, page: PageResult, fetchedAt: Date): PageRowInput {
  if (page.kind !== "ok") {
    const state: PageState = page.kind;
    return { slug, state, fetchedAt, expiresAt: pageExpiresAt(state, null, fetchedAt) };
  }
  const meta = scoreOf(page.scores, "metascore");
  const user = scoreOf(page.scores, "user_score");
  return {
    slug,
    state: "ok",
    title: page.facts.title,
    releaseDate: page.facts.releaseDate,
    releaseYear: page.year,
    companies: [...page.facts.companies],
    platforms: [...page.facts.platforms],
    metascore: meta?.score ?? null,
    metascoreCount: meta?.reviewCount ?? null,
    userscore: user?.score ?? null,
    userscoreCount: user?.reviewCount ?? null,
    fetchedAt,
    expiresAt: pageExpiresAt("ok", page.facts.releaseDate, fetchedAt),
  };
}

export function pageResultFromRow(row: PageRow): PageResult {
  if (row.state === "not_found") return { kind: "not_found" };
  if (row.state !== "ok") return { kind: "parse_failed", status: 0 };
  const scores: ExternalScore[] = [];
  if (row.metascore !== null) scores.push({ scoreType: "metascore", score: row.metascore, scoreMax: 100, reviewCount: row.metascoreCount });
  if (row.userscore !== null) scores.push({ scoreType: "user_score", score: row.userscore, scoreMax: 100, reviewCount: row.userscoreCount });
  return { kind: "ok", title: row.title, year: row.releaseYear, facts: { title: row.title, releaseDate: row.releaseDate, companies: row.companies, platforms: row.platforms }, scores };
}

export interface CachedPages {
  getScoreById(slug: string, opts?: { forceRefresh?: boolean }): Promise<PageResult>;
}

export function createCachedPages(provider: Pick<MetacriticProvider, "getScoreById">, now: () => Date = () => new Date()): CachedPages {
  return {
    async getScoreById(slug, opts) {
      if (!SLUG_PATTERN.test(slug)) return provider.getScoreById(slug); // 不發請求，也不進快取
      const cached = await getPage(slug);
      if (cached && !opts?.forceRefresh && cached.expiresAt.getTime() > now().getTime()) return pageResultFromRow(cached);
      const page = await provider.getScoreById(slug);
      // 重抓失敗不蓋掉先前讀到的好資料（改版時一次解析失敗不該洗掉整批快取）
      if (!(page.kind === "parse_failed" && cached && cached.state !== "parse_failed")) await upsertPage(pageRowFromResult(slug, page, now()));
      return page;
    },
  };
}

/** 從 slugs 中挑出「沒有未過期快取」的（補頁面資料只需要抓這些）。 */
export async function slugsWithoutFreshPage(slugs: readonly string[], now: Date = new Date()): Promise<string[]> {
  const fresh = new Set((await getPagesBySlugs(slugs)).filter((r) => r.expiresAt.getTime() > now.getTime()).map((r) => r.slug));
  return slugs.filter((s) => !fresh.has(s));
}

export interface PageFacts {
  state: PageState;
  title: string | null;
  releaseDate: string | null;
  companies: string[];
  platforms: string[];
  fetchedAt: string;
}

/** 校驗頁用：slug → 頁面資料（不論是否過期；沒有列的 slug 不在結果裡）。 */
export async function loadPageFacts(slugs: readonly string[]): Promise<Record<string, PageFacts>> {
  const out: Record<string, PageFacts> = {};
  for (const r of await getPagesBySlugs(slugs)) out[r.slug] = { state: r.state as PageState, title: r.title, releaseDate: r.releaseDate, companies: r.companies, platforms: r.platforms, fetchedAt: r.fetchedAt.toISOString() };
  return out;
}
