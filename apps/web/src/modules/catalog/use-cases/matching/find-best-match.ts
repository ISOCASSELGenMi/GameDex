/**
 * 標題比對的信心評分（05 §信心評分）。純函式、無 DB。寧可少自動配對，也不要配錯遊戲。
 */
import type { Candidate, MatchResult } from "../../domain/entities";
import { normalizeTitle } from "./normalize-title";
import { levenshteinSimilarity } from "./similarity";

export const MATCH_THRESHOLDS = {
  /** < 60 → 無候選。 */
  candidateMin: 60,
  /** ≥ 85 → 自動採用（仍需最佳與次佳差距 ≥ runnerUpGap）。 */
  autoMin: 85,
  runnerUpGap: 5,
  /** 一方 token 是另一方真子集（原作 vs 續作／重製）時的上限。 */
  subsetCap: 84,
  yearSame: 0.05,
  yearFarPenalty: 0.2,
  yearFarYears: 2,
  platformOverlap: 0.03,
} as const;

export interface FindBestMatchOptions {
  /** 我方遊戲的平台鍵（與 Candidate.platforms 同一套）；兩邊都有且有交集 +0.03。選用。 */
  platforms?: readonly string[];
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

function isProperSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === b.size) return false;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function yearAdjustment(ours: number | null, theirs: number | null): number {
  if (ours == null || theirs == null) return 0;
  const diff = Math.abs(ours - theirs);
  if (diff === 0) return MATCH_THRESHOLDS.yearSame;
  if (diff > MATCH_THRESHOLDS.yearFarYears) return -MATCH_THRESHOLDS.yearFarPenalty;
  return 0;
}

interface Scored {
  candidate: Candidate;
  pct: number;
}

function scoreCandidate(
  ours: readonly { normalized: string; tokens: Set<string> }[],
  candidate: Candidate,
  year: number | null,
  platforms: readonly string[] | undefined,
): number | null {
  const theirNorm = normalizeTitle(candidate.name);
  if (theirNorm === "") return null; // 空字串＝無法比對
  const theirTokens = tokens(theirNorm);
  let adj = yearAdjustment(year, candidate.releaseYear);
  if (platforms && candidate.platforms && platforms.some((p) => candidate.platforms!.includes(p))) {
    adj += MATCH_THRESHOLDS.platformOverlap;
  }
  let best: number | null = null;
  for (const o of ours) {
    const sim = levenshteinSimilarity(o.normalized, theirNorm);
    let pct = Math.round(clamp01(sim + adj) * 100);
    if (isProperSubset(o.tokens, theirTokens)) pct = Math.min(pct, MATCH_THRESHOLDS.subsetCap);
    if (best === null || pct > best) best = pct;
  }
  return best;
}

/**
 * 我方 name 與所有 altNames 各自對候選名稱比對，取最高；年份相同 +0.05、差距 > 2 年 −0.2、任一方 NULL 不加減；
 * token 子集上限 84；< 60 回 null（無候選）；60~84 needsReview；≥ 85 自動採用，但與次佳差 < 5 仍 needsReview。
 * 正規化後為空的名稱（我方或候選）一律不計。
 */
export function findBestMatch(
  name: string,
  altNames: readonly string[],
  year: number | null,
  candidates: readonly Candidate[],
  options: FindBestMatchOptions = {},
): MatchResult | null {
  const seen = new Set<string>();
  const ours: { normalized: string; tokens: Set<string> }[] = [];
  for (const n of [name, ...altNames]) {
    const normalized = normalizeTitle(n);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    ours.push({ normalized, tokens: tokens(normalized) });
  }
  if (ours.length === 0) return null;

  // 同一 externalId 重複出現只留最高分
  const byId = new Map<string, Scored>();
  for (const candidate of candidates) {
    const pct = scoreCandidate(ours, candidate, year, options.platforms);
    if (pct === null) continue;
    const prev = byId.get(candidate.externalId);
    if (!prev || pct > prev.pct) byId.set(candidate.externalId, { candidate, pct });
  }
  const ranked = [...byId.values()].sort((a, b) => b.pct - a.pct); // 同分維持輸入順序（穩定排序）
  const best = ranked[0];
  if (!best || best.pct < MATCH_THRESHOLDS.candidateMin) return null;

  const runnerUp = ranked[1];
  const needsReview =
    best.pct < MATCH_THRESHOLDS.autoMin || (runnerUp !== undefined && best.pct - runnerUp.pct < MATCH_THRESHOLDS.runnerUpGap);
  return {
    externalId: best.candidate.externalId,
    name: best.candidate.name,
    externalUrl: best.candidate.externalUrl ?? null,
    confidencePct: best.pct,
    needsReview,
  };
}
