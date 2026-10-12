/**
 * sync_platforms（04 §平台同步）：每日一次，整表重抓平台、平台家族與硬體上市日。
 * 硬體上市日：只採原版機（見 pickOriginalVersionDates），同地區取最早；`source='manual'` 不覆蓋。
 */
import type {
  DatePrecision,
  PlatformFamilyRecord,
  PlatformReleaseDateRecord,
  PlatformVersionRecord,
} from "../../domain/entities";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { syncIgdbPlatform, upsertIgdbPlatformFamilies } from "../../repository/platforms";
import { listRegions } from "../../repository/regions";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export interface SyncPlatformsStats {
  fetched: number;
  inserted: number;
  updated: number;
  manualSkipped: number;
  slugAdjusted: number;
  failed: number;
  families: number;
}

const PRECISION_RANK: Record<DatePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

/**
 * 同平台同地區取最早：比 periodStart（期間第一天）；同一天時精度較細者優先；tbd 只在該地區沒有其他日期時保留。
 */
export function pickEarliestPerRegion(dates: readonly PlatformReleaseDateRecord[]): PlatformReleaseDateRecord[] {
  const best = new Map<string, PlatformReleaseDateRecord>();
  for (const d of dates) {
    const cur = best.get(d.regionCode);
    if (!cur || isEarlier(d, cur)) best.set(d.regionCode, d);
  }
  return [...best.values()];
}

/**
 * 原版機的上市日（使用者決定，2026-10-12）：IGDB 常把改版機（PS5 Pro、PS4 Slim）登記成 WW，
 * 若各版本混在一起取最早，WW 會變成改版機的日期。原版＝含全平台最早日期的版本；並列時一起採用。
 * 原版沒有的地區不從改版機補。沒有任何日期的版本不參與。
 */
export function pickOriginalVersionDates(versions: readonly PlatformVersionRecord[]): PlatformReleaseDateRecord[] {
  let earliest: PlatformReleaseDateRecord | undefined;
  for (const v of versions) for (const d of v.releaseDates) if (!earliest || isEarlier(d, earliest)) earliest = d;
  if (!earliest) return [];
  const first = earliest.periodStart;
  const originals = versions.filter((v) =>
    v.releaseDates.some((d) => (first === null ? d.periodStart === null : d.periodStart === first)),
  );
  return pickEarliestPerRegion(originals.flatMap((v) => v.releaseDates));
}

function isEarlier(a: PlatformReleaseDateRecord, b: PlatformReleaseDateRecord): boolean {
  if (a.periodStart === null) return false;
  if (b.periodStart === null) return true;
  if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart;
  return PRECISION_RANK[a.precision] < PRECISION_RANK[b.precision];
}

export async function syncPlatforms(provider: GameDataProvider, log: Log): Promise<SyncPlatformsStats> {
  const records = await provider.fetchPlatforms();

  const families = new Map<number, PlatformFamilyRecord>();
  for (const r of records) if (r.family) families.set(r.family.igdbId, r.family);
  const familyIds = await upsertIgdbPlatformFamilies([...families.values()]);

  const regionIds = new Map((await listRegions()).map((r) => [r.code, r.id]));

  const stats: SyncPlatformsStats = {
    fetched: records.length,
    inserted: 0,
    updated: 0,
    manualSkipped: 0,
    slugAdjusted: 0,
    failed: 0,
    families: families.size,
  };

  for (const r of records) {
    const releaseDates = [];
    for (const d of pickOriginalVersionDates(r.versions)) {
      const regionId = regionIds.get(d.regionCode);
      if (regionId === undefined) {
        log("地區不在 regions 表（seed 未執行？），略過", { igdbId: r.igdbId, regionCode: d.regionCode });
        continue;
      }
      releaseDates.push({ regionId, releaseDate: d.releaseDate, precision: d.precision });
    }
    try {
      const res = await syncIgdbPlatform({
        igdbId: r.igdbId,
        name: r.name,
        slug: r.slug,
        abbreviation: r.abbreviation,
        alternativeName: r.alternativeName,
        kind: r.kind,
        generation: r.generation,
        familyId: r.family ? (familyIds.get(r.family.igdbId) ?? null) : null,
        logoUrl: r.logoUrl,
        summary: r.summary,
        releaseDates,
      });
      if (res.kind === "manual_skipped") {
        stats.manualSkipped += 1;
        continue;
      }
      stats[res.kind] += 1;
      if (res.slug !== r.slug) {
        stats.slugAdjusted += 1;
        log("slug 已被其他平台使用，改用帶 id 的 slug", { igdbId: r.igdbId, slug: res.slug });
      }
    } catch (err) {
      // 單筆失敗不中斷整批；結束時丟錯讓心跳記為失敗
      stats.failed += 1;
      log("平台寫入失敗", { igdbId: r.igdbId, name: r.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  log("平台同步完成", { ...stats });
  if (stats.failed > 0) throw new Error(`sync_platforms：${stats.failed} 筆平台寫入失敗（見 log）`);
  return stats;
}
