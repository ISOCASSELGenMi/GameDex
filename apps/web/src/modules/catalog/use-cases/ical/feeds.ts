/**
 * 公開 iCal feed 的組裝（08 §公開 feed）：查詢（repository/ical.ts，聚合規則共用 release-aggregate.ts）→ 產生函式。
 *
 * 流程（薄路由 catalog/api/ical.ts 呼叫）：
 * 1. `prepareIcalFeed` 驗證 feed 存在（平台／遊戲不存在 → null → 404），用**一個聚合查詢**算 ETag（不先產生整份）。
 * 2. 路由比對 If-None-Match，相符回 304；否則呼叫 `render()` 產生 ics。
 *
 * ETag = hash(max(updated_at), count, settingsVersion, locale, feed 參數, 今天, 格式版本)：
 * - `count` 必須納入：刪除或撤銷不會改變 max(updated_at)（08 §HTTP 快取）。
 * - settingsVersion：公開 feed 固定 0（私人 feed 改語系才 +1）。
 * - 今天（UTC 日期）與格式版本是本實作加的：視窗隨日期移動，同一天內「一個進、一個出」時 count 與 max(updated_at)
 *   可能都不變而內容已變；ETag 每個 UTC 日換一次（每天最多多一次完整下載）。格式版本讓產生規則改版時 ETag 一併改變。
 */
import { createHash } from "node:crypto";
import type { Locale } from "@sok/i18n";
import { getCoreEnv } from "@/kernel/config/env";
import {
  RELEASE_STATUSES,
  type IcalEventItem,
  type IcalFeedKind,
  type IcalFeedMeta,
  type IcalReleaseItem,
  type IsoDate,
  type ResolvedReleaseFilter,
} from "../../domain/entities";
import { utcToday } from "../../domain/utc-date";
import {
  findIcalGameBySlug,
  findIcalPlatformBySlug,
  getIcalEventMeta,
  getIcalReleaseMeta,
  listIcalEvents,
  listIcalReleases,
  type IcalReleaseQuery,
} from "../../repository/ical";
import { resolveFilterSlugs, resolveRegionPref } from "../read/resolve-filter";
import { ICAL_FORMAT_VERSION, generateIcs, icalUidDomain, type IcalLinkBuilder } from "./generate";

/** 平台 feed 的安全上限（平台別 feed 是「想看更多」的出口，不套 ICAL_PUBLIC_MAX_EVENTS；這只是防呆）。 */
export const ICAL_PLATFORM_MAX_EVENTS = 5000;

export type IcalFeedSpec =
  | { kind: "releases" }
  | { kind: "events" }
  | { kind: "platform"; slug: string }
  | { kind: "game"; slug: string };

export interface PrepareIcalFeedInput {
  spec: IcalFeedSpec;
  locale: Locale;
  links: IcalLinkBuilder;
  /** 測試用：固定「今天」（UTC 日期）。 */
  today?: IsoDate;
  /** 私人 feed 改語系才會 +1；公開 feed 一律 0。 */
  settingsVersion?: number;
}

export interface PreparedIcalFeed {
  etag: string;
  meta: IcalFeedMeta;
  /** 下載檔名（game feed 用；其他 feed 不送 Content-Disposition）。 */
  fileName: string;
  /** 產生整份 ics。 */
  render(): Promise<string>;
}

/** ETag 公式（純函式，單元測試用）。回傳含引號的強 ETag。 */
export function computeIcalEtag(input: {
  meta: IcalFeedMeta;
  settingsVersion: number;
  locale: string;
  feedKey: string;
  today: IsoDate;
}): string {
  const raw = [
    input.meta.maxUpdatedAt ? input.meta.maxUpdatedAt.toISOString() : "none",
    String(input.meta.count),
    String(input.settingsVersion),
    input.locale,
    input.feedKey,
    input.today,
    `v${ICAL_FORMAT_VERSION}`,
  ].join("|");
  return `"${createHash("sha256").update(raw).digest("hex").slice(0, 32)}"`;
}

/** If-None-Match 是否命中（支援逗號分隔多個、`*`、弱驗證 `W/` 前綴）。 */
export function ifNoneMatchHits(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, "");
  return header.split(",").some((part) => {
    const v = part.trim();
    return v === "*" || v.replace(/^W\//, "") === want;
  });
}

async function releaseFilter(): Promise<ResolvedReleaseFilter> {
  // 狀態全部列入（cancelled 要保留 30 天）；階段、遊戲類型沿用 CALENDAR_VISIBLE_*；排除 rumored（預設）
  const { filter } = await resolveFilterSlugs({ statuses: [...RELEASE_STATUSES] });
  return filter;
}

export async function prepareIcalFeed(input: PrepareIcalFeedInput): Promise<PreparedIcalFeed | null> {
  const today = input.today ?? utcToday();
  const settingsVersion = input.settingsVersion ?? 0;
  const locale = input.locale;
  const env = getCoreEnv();
  const uidDomain = icalUidDomain(env.NEXT_PUBLIC_SITE_URL);
  const common = { locale, uidDomain, links: input.links };
  const etagOf = (meta: IcalFeedMeta, feedKey: string) => computeIcalEtag({ meta, settingsVersion, locale, feedKey, today });
  const regionPref = resolveRegionPref(null);

  switch (input.spec.kind) {
    case "events": {
      const q = { today, limit: env.ICAL_PUBLIC_MAX_EVENTS };
      const meta = await getIcalEventMeta(q);
      return {
        etag: etagOf(meta, "events"),
        meta,
        fileName: "events.ics",
        async render() {
          const events: IcalEventItem[] = await listIcalEvents(q);
          return generateIcs({ ...common, feed: { kind: "events" }, releases: [], events });
        },
      };
    }
    case "releases":
    case "platform": {
      const platform = input.spec.kind === "platform" ? await findIcalPlatformBySlug(input.spec.slug) : null;
      if (input.spec.kind === "platform" && !platform) return null;
      const base = await releaseFilter();
      const filter: ResolvedReleaseFilter = platform ? { ...base, platformIds: [platform.id] } : base;
      const limit = platform ? ICAL_PLATFORM_MAX_EVENTS : env.ICAL_PUBLIC_MAX_EVENTS;
      const query: IcalReleaseQuery = { scope: { type: "public", today, limit }, filter, locale, regionPref };
      const meta = await getIcalReleaseMeta(query);
      const kind: IcalFeedKind = platform ? "platform" : "releases";
      return {
        etag: etagOf(meta, platform ? `platform:${platform.slug}` : "releases"),
        meta,
        fileName: platform ? `${platform.slug}.ics` : "releases.ics",
        async render() {
          const releases: IcalReleaseItem[] = await listIcalReleases(query);
          return generateIcs({ ...common, feed: { kind, platformName: platform?.name ?? null }, releases, events: [] });
        },
      };
    }
    case "game": {
      const game = await findIcalGameBySlug(input.spec.slug, locale);
      if (!game) return null;
      const filter = await releaseFilter();
      const query: IcalReleaseQuery = { scope: { type: "game", gameId: game.id, today }, filter, locale, regionPref };
      const meta = await getIcalReleaseMeta(query);
      return {
        etag: etagOf(meta, `game:${game.slug}`),
        meta,
        fileName: `${game.slug}.ics`,
        async render() {
          const releases = await listIcalReleases(query);
          return generateIcs({ ...common, feed: { kind: "game", gameName: game.name }, releases, events: [] });
        },
      };
    }
  }
}
