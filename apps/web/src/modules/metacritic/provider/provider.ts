/**
 * Metacritic 的 RatingProvider（05）：把 metacritic.com 的頁面轉成我方型別（ExternalScore）。
 * 外部格式（HTML、sitemap）到此為止，上層只看到 PageResult。
 */
import type { ExternalScore } from "@/modules/catalog";
import { METACRITIC_ORIGIN, type MetacriticHttp } from "./http";
import { parseGamePage, parseSitemapLocs, slugFromGameUrl } from "./parse";

export const METACRITIC_SOURCE = "metacritic_scrape";
export const METACRITIC_SCORE_ORIGIN = "metacritic";
export const METACRITIC_SCORE_TYPES = ["metascore", "user_score"] as const;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,200}$/;

export type PageResult =
  | { kind: "ok"; title: string | null; year: number | null; scores: ExternalScore[] }
  | { kind: "not_found" }
  | { kind: "parse_failed"; status: number };

export const gameUrl = (slug: string) => `${METACRITIC_ORIGIN}/game/${slug}/`;

export interface MetacriticProvider {
  readonly sourceName: typeof METACRITIC_SOURCE;
  /** 一次請求取得 metascore 與玩家評分（玩家評分 10 分制換成 100 分制）。 */
  getScoreById(slug: string): Promise<PageResult>;
  /** sitemap 索引裡的分片路徑（/games/N.xml）。 */
  listSitemapShards(): Promise<string[] | null>;
  /** 一個分片裡的遊戲 slug。 */
  fetchSitemapSlugs(shardPath: string): Promise<string[] | null>;
}

export function createMetacriticProvider(http: MetacriticHttp): MetacriticProvider {
  return {
    sourceName: METACRITIC_SOURCE,

    async getScoreById(slug) {
      if (!SLUG_PATTERN.test(slug)) return { kind: "not_found" };
      const res = await http.get(`/game/${slug}/`);
      if (res.status === 404) return { kind: "not_found" };
      if (res.status !== 200) return { kind: "parse_failed", status: res.status };
      const page = parseGamePage(res.body);
      if (!page) return { kind: "parse_failed", status: res.status };
      const scores: ExternalScore[] = [];
      if (page.metascore) scores.push({ scoreType: "metascore", score: page.metascore.value, scoreMax: 100, reviewCount: page.metascore.count });
      if (page.userScore) scores.push({ scoreType: "user_score", score: Math.round(page.userScore.value * 10), scoreMax: 100, reviewCount: page.userScore.count });
      return { kind: "ok", title: page.title, year: page.releaseYear, scores };
    },

    async listSitemapShards() {
      const res = await http.get("/games.xml", "application/xml");
      if (res.status !== 200) return null;
      const shards = parseSitemapLocs(res.body)
        .map((u) => (u.startsWith(METACRITIC_ORIGIN) ? u.slice(METACRITIC_ORIGIN.length) : null))
        .filter((p): p is string => p !== null && /^\/games\/\d+\.xml$/.test(p));
      return shards.length > 0 ? shards : null;
    },

    async fetchSitemapSlugs(shardPath) {
      if (!/^\/games\/\d+\.xml$/.test(shardPath)) return null;
      const res = await http.get(shardPath, "application/xml");
      if (res.status !== 200) return null;
      return parseSitemapLocs(res.body)
        .map(slugFromGameUrl)
        .filter((s): s is string => s !== null);
    },
  };
}
