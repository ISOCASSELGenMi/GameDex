/**
 * 私人追蹤 feed 的組裝（08 §私人 feed；accounts 的 /ical/u/{token}.ics 呼叫）。
 * 與公開 feed 同一條路：repository/ical.ts 的挑選（聚合規則共用 release-aggregate.ts）→ generateIcs（唯一的 ics 產生函式，D46）。
 * 呼叫端（accounts）只傳「使用者追蹤了哪些 id」與 feed 設定；catalog 不認識 follows 表。
 *
 * 內容規則：
 * - 追蹤的遊戲：上市事件不受 90 天視窗限制，過去的保留近 30 天。
 * - 追蹤的平台／系列／公司：旗下遊戲的上市事件，90 天視窗，合計最多 ICAL_PUBLIC_MAX_EVENTS 筆（依熱度取前 N）。
 * - 追蹤的活動：一律輸出（明確追蹤）。includeEvents＝另外含與追蹤遊戲相關的活動（event_games，最多 ICAL_PUBLIC_MAX_EVENTS 筆）。
 * - includeReleases＝false：不輸出任何上市事件。
 * - 篩選（平台、類型、階段）取交集；地區只當偏好（見 filterRegionCodes）。
 * ETag 另外納入「追蹤集合與設定」的雜湊：換掉一款追蹤的遊戲時 count 與 max(updated_at) 可能不變、內容卻變了。
 */
import { createHash } from "node:crypto";
import type { Locale } from "@sok/i18n";
import { getCoreEnv } from "@/kernel/config/env";
import { RELEASE_STATUSES, type IcalFeedMeta, type IsoDate, type ResolvedReleaseFilter } from "../../domain/entities";
import { utcToday } from "../../domain/utc-date";
import {
  getIcalFollowingEventMeta,
  getIcalReleaseMeta,
  listIcalFollowingEvents,
  listIcalReleases,
  type IcalFollowingEventScope,
  type IcalReleaseQuery,
} from "../../repository/ical";
import { resolveFilterSlugs, resolveRegionPref } from "../read/resolve-filter";
import { computeIcalEtag } from "./feeds";
import { generateIcs, icalUidDomain, type IcalLinkBuilder } from "./generate";
import type { PreparedIcalFeed } from "./feeds";

export interface FollowingFeedFollows {
  gameIds: readonly number[];
  eventIds: readonly number[];
  platformIds: readonly number[];
  franchiseIds: readonly number[];
  companyIds: readonly number[];
}

export interface FollowingFeedInput {
  locale: Locale;
  /** 日曆名稱（使用者設定的 feed 名稱，X-WR-CALNAME）。 */
  calendarName: string;
  links: IcalLinkBuilder;
  follows: FollowingFeedFollows;
  /** feed 的篩選設定；空陣列＝不限制。 */
  filters: {
    platformIds: readonly number[];
    /** 地區代碼（regions.code）；只當偏好（第一個有效的當 regionPref），不是限制——IGDB 多數日期掛在 WW，硬限制會讓遊戲消失。 */
    regionCodes: readonly string[];
    genreSlugs: readonly string[];
    stages: readonly string[];
  };
  includeReleases: boolean;
  includeEvents: boolean;
  /** feeds.settingsVersion（納入 ETag）。 */
  settingsVersion: number;
  /** 測試用：固定「今天」（UTC 日期）。 */
  today?: IsoDate;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const sorted = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** 追蹤集合與設定的指紋（進 ETag）。 */
export function followingFeedKey(input: Pick<FollowingFeedInput, "follows" | "filters" | "includeReleases" | "includeEvents">): string {
  const f = input.follows;
  return `following:${sha(
    JSON.stringify([
      sorted(f.gameIds), sorted(f.eventIds), sorted(f.platformIds), sorted(f.franchiseIds), sorted(f.companyIds),
      sorted(input.filters.platformIds), [...input.filters.regionCodes], [...input.filters.genreSlugs], [...input.filters.stages],
      input.includeReleases, input.includeEvents,
    ]),
  )}`;
}

const mergeMeta = (a: IcalFeedMeta, b: IcalFeedMeta): IcalFeedMeta => ({
  count: a.count + b.count,
  maxUpdatedAt: a.maxUpdatedAt && b.maxUpdatedAt ? (a.maxUpdatedAt > b.maxUpdatedAt ? a.maxUpdatedAt : b.maxUpdatedAt) : (a.maxUpdatedAt ?? b.maxUpdatedAt),
});

/** 準備私人追蹤 feed：用兩個聚合查詢算 ETag（不先產生整份）；沒有任何追蹤範圍時完全不查詢資料庫（空 ics）。 */
export async function prepareFollowingIcalFeed(input: FollowingFeedInput): Promise<PreparedIcalFeed> {
  const today = input.today ?? utcToday();
  const env = getCoreEnv();
  const f = input.follows;
  const uidDomain = icalUidDomain(env.NEXT_PUBLIC_SITE_URL);
  const cap = env.ICAL_PUBLIC_MAX_EVENTS;

  const hasReleaseScope =
    input.includeReleases && (f.gameIds.length + f.platformIds.length + f.franchiseIds.length + f.companyIds.length > 0);
  const eventScope: IcalFollowingEventScope = {
    today,
    eventIds: sorted(f.eventIds),
    relatedGameIds: input.includeEvents ? sorted(f.gameIds) : [],
    relatedLimit: cap,
  };

  let releaseQuery: IcalReleaseQuery | null = null;
  if (hasReleaseScope) {
    const { filter: base } = await resolveFilterSlugs({
      statuses: [...RELEASE_STATUSES], // cancelled 要保留 30 天（同公開 feed）
      ...(input.filters.genreSlugs.length > 0 ? { genreSlugs: [...input.filters.genreSlugs] } : {}),
      ...(input.filters.stages.length > 0 ? { stages: [...input.filters.stages] } : {}),
    });
    const filter: ResolvedReleaseFilter = input.filters.platformIds.length > 0 ? { ...base, platformIds: [...input.filters.platformIds] } : base;
    const regionPref = resolveRegionPref(input.filters.regionCodes[0] ?? null);
    releaseQuery = {
      scope: {
        type: "following",
        today,
        limit: cap,
        gameIds: sorted(f.gameIds),
        platformIds: sorted(f.platformIds),
        franchiseIds: sorted(f.franchiseIds),
        companyIds: sorted(f.companyIds),
      },
      filter,
      locale: input.locale,
      regionPref,
    };
  }

  const releaseMeta = releaseQuery ? await getIcalReleaseMeta(releaseQuery) : { count: 0, maxUpdatedAt: null };
  const eventMeta = await getIcalFollowingEventMeta(eventScope);
  const meta = mergeMeta(releaseMeta, eventMeta);
  return {
    etag: computeIcalEtag({
      meta,
      settingsVersion: input.settingsVersion,
      locale: input.locale,
      feedKey: followingFeedKey(input),
      today,
    }),
    meta,
    fileName: "following.ics",
    async render() {
      const releases = releaseQuery ? await listIcalReleases(releaseQuery) : [];
      const events = await listIcalFollowingEvents(eventScope);
      return generateIcs({
        locale: input.locale,
        uidDomain,
        links: input.links,
        feed: { kind: "following", calendarName: input.calendarName },
        releases,
        events,
      });
    },
  };
}
