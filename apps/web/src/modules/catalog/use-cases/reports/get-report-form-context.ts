/**
 * 回報表單頁需要的資料（12 §入口）：解析目標（伺服器驗證存在）、可選的回報類型、平台與地區選單。
 * 目標以公開網址上有的識別碼指定：遊戲／平台／活動用 slug，上市事件用 id（詳情頁每列都有）。
 */
import type { IsoDate, ReleaseStage, ReportTargetType, ReportType, DatePrecision } from "../../domain/entities";
import { reportTypesForTarget } from "../../domain/report-validation";
import { listRegions } from "../../repository/regions";
import {
  findEventRef,
  findGameRef,
  findPlatformRef,
  findReleaseEventRow,
  getPlatformNames,
  listLanguageOptions,
  listReportablePlatforms,
} from "../../repository/reports";

export type ReportTargetRef =
  | { kind: "game"; slug: string }
  | { kind: "platform"; slug: string }
  | { kind: "event"; slug: string }
  | { kind: "release_event"; id: number };

export interface ReportFormContext {
  targetType: ReportTargetType;
  targetId: number;
  /** 目標名稱（遊戲、平台、活動的原文名稱）。 */
  name: string;
  /** 目標公開頁（不含語系前綴）。 */
  path: string;
  /** 目標所屬遊戲（game／release_event 才有）。 */
  game: { id: number; slug: string; name: string } | null;
  reportTypes: ReportType[];
  /** 遊戲的平台（missing_region_date 的平台選單）。 */
  platforms: Array<{ id: number; name: string }>;
  regions: Array<{ code: string }>;
  languages: Array<{ code: string; name: string; nativeName: string | null }>;
  /** 目標是上市事件時的現況。 */
  releaseEvent: {
    id: number;
    platformName: string;
    regionCode: string;
    stage: ReleaseStage;
    date: IsoDate | null;
    precision: DatePrecision;
  } | null;
}

/** 找不到目標回 null（頁面回 404）。 */
export async function getReportFormContext(ref: ReportTargetRef): Promise<ReportFormContext | null> {
  const base = { platforms: [], regions: [], languages: [], game: null, releaseEvent: null };
  if (ref.kind === "platform" || ref.kind === "event") {
    const target = ref.kind === "platform" ? await findPlatformRef({ slug: ref.slug }) : await findEventRef({ slug: ref.slug });
    if (!target) return null;
    return {
      ...base,
      targetType: ref.kind,
      targetId: target.id,
      name: target.name,
      path: `/${ref.kind === "platform" ? "platforms" : "events"}/${encodeURIComponent(target.slug)}`,
      reportTypes: reportTypesForTarget(ref.kind),
    };
  }

  let releaseEvent: ReportFormContext["releaseEvent"] = null;
  let gameRef: { id: number; slug: string; name: string } | null;
  if (ref.kind === "release_event") {
    const row = await findReleaseEventRow(ref.id);
    gameRef = row ? await findGameRef({ id: row.gameId }) : null;
    if (!row || !gameRef) return null;
    const [regions, names] = await Promise.all([listRegions(), getPlatformNames([row.platformId])]);
    releaseEvent = {
      id: row.id,
      platformName: names.get(row.platformId) ?? "",
      regionCode: regions.find((r) => r.id === row.regionId)?.code ?? "",
      stage: row.releaseStage,
      date: row.releaseDate,
      precision: row.precision,
    };
  } else {
    gameRef = await findGameRef({ slug: ref.slug });
    if (!gameRef) return null;
  }

  const [platforms, regions, languages] = await Promise.all([
    listReportablePlatforms(gameRef.id),
    listRegions(),
    listLanguageOptions(),
  ]);
  return {
    targetType: ref.kind,
    targetId: ref.kind === "release_event" ? ref.id : gameRef.id,
    name: gameRef.name,
    path: `/games/${encodeURIComponent(gameRef.slug)}`,
    game: gameRef,
    reportTypes: reportTypesForTarget(ref.kind),
    platforms: platforms.map((p) => ({ id: p.id, name: p.name })),
    regions: regions.map((r) => ({ code: r.code })),
    languages,
    releaseEvent,
  };
}
