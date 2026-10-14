/**
 * 熱度的參數與純函式（03 §熱度；權重與門檻是未驗證的起始值，P14）。
 * 30 萬款的實際計算在 repository/popularity.ts 的 SQL，SQL 內的權重、門檻、分群天數都來自這裡（原則五）；
 * 這裡的函式供單元測試與整合測試對照 SQL 結果。
 */
import type { ExternalHypeKind, ExternalHypeRecord } from "./entities/popularity";

/** 上市後幾天內仍算 upcoming 群（03 §熱度 步驟 2）。 */
export const UPCOMING_WINDOW_DAYS = 30;

/** 站內追蹤權重上限（wSite 最多 0.6）。 */
export const SITE_WEIGHT_MAX = 0.6;
/** 剩餘權重的分配：IGDB 0.7／結構 0.3。 */
export const IGDB_SHARE = 0.7;
export const STRUCT_SHARE = 0.3;

/** heatLevel 門檻（群內依 popularityScore 由高到低的前 x%）；未列到的有訊號遊戲 → 1，完全無訊號 → 0。 */
export const HEAT_LEVEL_THRESHOLDS: ReadonlyArray<{ level: number; topFraction: number }> = [
  { level: 5, topFraction: 0.01 },
  { level: 4, topFraction: 0.05 },
  { level: 3, topFraction: 0.15 },
  { level: 2, topFraction: 0.4 },
];

/** popularityScore 上限。 */
export const POPULARITY_SCORE_MAX = 1000;
/** igdb_hype 存成整數（game_popularity_signals.value 是 integer），百分位 × 這個倍數。 */
export const HYPE_VALUE_SCALE = 1_000_000;

export interface HeatWeights {
  site: number;
  igdb: number;
  struct: number;
}

/**
 * 03 §熱度 步驟 3：`wSite = 0.6 × min(1, 全站追蹤總數 ÷ HEAT_COLD_START_FOLLOWS)`，
 * 其餘按 IGDB 0.7／結構 0.3；群內沒有任何 IGDB 訊號 → 其餘全給結構。
 * coldStartFollows ≤ 0 視為立即達滿（避免除以 0）。
 */
export function resolveHeatWeights(input: {
  siteFollowsTotal: number;
  coldStartFollows: number;
  hasIgdbSignal: boolean;
}): HeatWeights {
  const total = Math.max(0, input.siteFollowsTotal);
  const ratio = input.coldStartFollows > 0 ? Math.min(1, total / input.coldStartFollows) : total > 0 ? 1 : 0;
  const site = SITE_WEIGHT_MAX * ratio;
  const rest = 1 - site;
  if (!input.hasIgdbSignal) return { site, igdb: 0, struct: rest };
  return { site, igdb: rest * IGDB_SHARE, struct: rest * STRUCT_SHARE };
}

/** `round(1000 × Σ w·p)`，p 為群內 PERCENT_RANK（0~1）；缺訊號的 p 視為 0。結果夾在 0~1000。 */
export function popularityScoreOf(w: HeatWeights, p: { site?: number; igdb?: number; struct?: number }): number {
  const raw = w.site * (p.site ?? 0) + w.igdb * (p.igdb ?? 0) + w.struct * (p.struct ?? 0);
  return Math.min(POPULARITY_SCORE_MAX, Math.max(0, Math.round(POPULARITY_SCORE_MAX * raw)));
}

/**
 * 03 §熱度 步驟 4。`topFraction`＝群內（有訊號的遊戲之間）依分數由高到低的 PERCENT_RANK（0＝第一名）。
 * 前 1% → 5、5% → 4、15% → 3、40% → 2、其餘 → 1；完全無訊號 → 0。
 */
export function heatLevelOf(topFraction: number, hasSignal: boolean): number {
  if (!hasSignal) return 0;
  for (const t of HEAT_LEVEL_THRESHOLDS) if (topFraction < t.topFraction) return t.level;
  return 1;
}

/**
 * 外部人氣原始值 → 每款遊戲一個整數 igdb_hype（03 §熱度：value 只用來排序）。
 * 各種類的 value 尺度不同（Want to Play 是占比、Most Wishlisted 是名次換算），所以先在種類內換成累積百分位
 * （值 ≤ 自己的比例，0~1，同值同分），再取各種類的最大值 × HYPE_VALUE_SCALE。結果一律 ≥ 1。
 * 同一款遊戲同種類重複出現時取最大值。
 */
export function combineHypeRecords(records: readonly ExternalHypeRecord[]): Map<number, number> {
  const byKind = new Map<ExternalHypeKind, Map<number, number>>();
  for (const r of records) {
    if (!Number.isFinite(r.value) || !Number.isInteger(r.igdbGameId) || r.igdbGameId <= 0) continue;
    let m = byKind.get(r.signal);
    if (!m) byKind.set(r.signal, (m = new Map()));
    const prev = m.get(r.igdbGameId);
    if (prev === undefined || r.value > prev) m.set(r.igdbGameId, r.value);
  }
  const out = new Map<number, number>();
  for (const m of byKind.values()) {
    const sorted = [...m.entries()].sort((a, b) => a[1] - b[1]);
    const n = sorted.length;
    // 累積百分位：同值的最後一個位置 ÷ n
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++;
      const scaled = Math.max(1, Math.round(((j + 1) / n) * HYPE_VALUE_SCALE));
      for (let k = i; k <= j; k++) {
        const id = sorted[k][0];
        out.set(id, Math.max(out.get(id) ?? 0, scaled));
      }
      i = j + 1;
    }
  }
  return out;
}

/** 依 UTC 日期判斷分群（與 SQL 的分群條件一致：無日期或 ≥ 今天 − 30 天 → upcoming）。 */
export function popularityGroupOf(firstReleaseDate: string | null, todayUtc: string): "upcoming" | "released" {
  if (!firstReleaseDate) return "upcoming";
  return firstReleaseDate >= upcomingCutoff(todayUtc) ? "upcoming" : "released";
}

/** upcoming 群的日期下限（今天 − UPCOMING_WINDOW_DAYS，`YYYY-MM-DD`，UTC）。 */
export function upcomingCutoff(todayUtc: string): string {
  const d = new Date(`${todayUtc}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - UPCOMING_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}
