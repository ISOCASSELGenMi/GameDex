/**
 * ics 產生函式（08；公開 feed、單一遊戲下載、原型驗證用 feed、之後的私人 feed 共用，D46）。
 *
 * 純函式：輸入「已挑好的上市項目＋活動＋語系」，輸出 ics 字串。同樣的輸入產生**位元組相同**的輸出——
 * 沒有任何「現在」的時間（DTSTAMP／LAST-MODIFIED 取資料的 updatedAt），輸出順序固定。
 *
 * 規則（08 §RFC 5545 規則、§日期精度 → 事件）：
 * - UID 永久不變、與語系無關：`release-g{gameId}-p{platformId}-s{stage}@{網域}`、`event-{id}@{網域}`。
 * - SEQUENCE：上市＝該組所有上市事件 sequence 總和（由查詢給）；活動＝start_time 改期次數。
 * - 精度：day 單日全天；month 整月（DTEND＝下月 1 日，排他）；quarter／year 用 releaseDate（期間最後一天）單日＋標記；
 *   tbd 原本有日期 → 留在最後已知日期，加 `[延期・日期未定]`＋`STATUS:TENTATIVE`，從未有日期 → 不輸出；
 *   取消 → `STATUS:CANCELLED`＋標記。保留 30 天、視窗等由查詢決定（repository/ical.ts）。
 * - 活動：絕對時間（UTC，不用 TZID）；endTime 為 NULL → +1 小時；startTime 一定有值（NULL 的不會進來）。
 * - 標記與說明文字全部來自 `ical` 字典；季／年標籤由 `formatReleaseLabel()` 產生。程式碼不寫死任何語言的文字。
 */
import ical, { ICalEventStatus, ICalEventTransparency } from "ical-generator";
import { createTranslator, formatReleaseLabel, parseIsoDate, type Locale, type Translator } from "@sok/i18n";
import {
  RELEASE_STAGES,
  type DatePrecision,
  type IcalEventItem,
  type IcalFeedKind,
  type IcalReleaseItem,
  type IsoDate,
} from "../../domain/entities";

/** UID 網域沒有設定 NEXT_PUBLIC_SITE_URL 時的固定值（開發、測試）。正式環境的網域一旦訂閱者出現就不能改（UID 會全部變）。 */
export const ICAL_FALLBACK_UID_DOMAIN = "sok.local";

/** REFRESH-INTERVAL／X-PUBLISHED-TTL（秒）。Apple 會用；Google 忽略（08 §更新延遲要誠實）。 */
export const ICAL_REFRESH_SECONDS = 6 * 60 * 60;

/** 輸出格式版本：產生規則改變時加 1，讓 ETag 隨之改變（內容變了但資料沒變）。 */
export const ICAL_FORMAT_VERSION = 1;

/** 活動沒有結束時間時的長度。 */
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

export interface IcalLinkBuilder {
  /** 站內絕對網址：遊戲詳情；回傳 null＝不輸出連結（沒設 NEXT_PUBLIC_SITE_URL）。 */
  game(slug: string): string | null;
  event(slug: string): string | null;
}

export interface IcalGenerateInput {
  locale: Locale;
  feed: {
    kind: IcalFeedKind;
    platformName?: string | null;
    gameName?: string | null;
    /** 覆寫日曆名稱（只有原型驗證 feed 用，好讓兩個 feed 在行事曆裡分得出來；正式 feed 不設）。 */
    calendarName?: string;
  };
  releases: readonly IcalReleaseItem[];
  events: readonly IcalEventItem[];
  /** UID 的網域（icalUidDomain）。 */
  uidDomain: string;
  links: IcalLinkBuilder;
}

/** UID 網域：NEXT_PUBLIC_SITE_URL 的 host；沒設或不合法 → ICAL_FALLBACK_UID_DOMAIN。 */
export function icalUidDomain(siteUrl: string | null | undefined): string {
  const raw = siteUrl?.trim();
  if (!raw) return ICAL_FALLBACK_UID_DOMAIN;
  try {
    return new URL(raw).host || ICAL_FALLBACK_UID_DOMAIN;
  } catch {
    return ICAL_FALLBACK_UID_DOMAIN;
  }
}

export function releaseUid(item: Pick<IcalReleaseItem, "gameId" | "platformId" | "stage">, domain: string): string {
  return `release-g${item.gameId}-p${item.platformId}-s${item.stage}@${domain}`;
}

export function eventUid(id: number, domain: string): string {
  return `event-${id}@${domain}`;
}

// ── 日期運算（全部 UTC 曆法）──────────────────────────────────────────────

function utcDate(iso: IsoDate): Date | null {
  const p = parseIsoDate(iso);
  return p ? p.utc : null;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** 當月第一天、下月第一天（DTEND 排他）。 */
function monthSpan(d: Date): { start: Date; end: Date } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
}

interface ReleaseView {
  item: IcalReleaseItem;
  /** 實際用來排版的日期與精度（tbd 用最後已知的）。 */
  date: IsoDate;
  precision: DatePrecision;
  postponed: boolean;
  cancelled: boolean;
}

/** 決定項目怎麼呈現；不該輸出（tbd 且從未有日期、日期不合法）→ null。 */
function viewOf(item: IcalReleaseItem): ReleaseView | null {
  const cancelled = item.status === "cancelled";
  const undated = item.precision === "tbd" || item.date == null;
  if (!undated) return { item, date: item.date as IsoDate, precision: item.precision, postponed: false, cancelled };
  if (item.lastKnownDate == null) return null;
  const precision = item.lastKnownPrecision && item.lastKnownPrecision !== "tbd" ? item.lastKnownPrecision : "day";
  return { item, date: item.lastKnownDate, precision, postponed: !cancelled, cancelled };
}

function stageRank(stage: string): number {
  const i = (RELEASE_STAGES as readonly string[]).indexOf(stage);
  return i < 0 ? RELEASE_STAGES.length : i;
}

function summaryOf(t: Translator, v: ReleaseView, locale: Locale): string {
  const { item } = v;
  const marks: string[] = [];
  if (v.cancelled) marks.push(t.t("ical.mark.cancelled"));
  else if (v.postponed) marks.push(t.t("ical.mark.postponed"));
  else if (v.precision === "month") marks.push(t.t("ical.mark.provisional"));
  else if (v.precision === "quarter" || v.precision === "year") {
    marks.push(t.t("ical.mark.provisionalLabel", { label: formatReleaseLabel(v.date, v.precision, locale) }));
  }
  const details = [item.platformAbbreviation?.trim() || item.platformName];
  if (item.stage !== "unspecified" && item.stage !== "full") details.push(t.t(`enums.releaseStage.${item.stage}`));
  const title = `${item.gameName}${t.t("ical.summaryDetail", { text: details.join(t.t("ui.common.listSeparator")) })}`;
  return [...marks, title].join(" ");
}

function releaseDescription(t: Translator, v: ReleaseView, url: string | null): string {
  const { item } = v;
  const lines = [t.t("ical.description.platform", { value: item.platformName })];
  const regionKey = `enums.region.${item.regionCode}`;
  lines.push(t.t("ical.description.region", { value: t.has(regionKey) ? t.t(regionKey) : item.regionCode }));
  if (item.stage !== "unspecified") lines.push(t.t("ical.description.stage", { value: t.t(`enums.releaseStage.${item.stage}`) }));
  lines.push(t.t("ical.description.status", { value: t.t(`enums.releaseStatus.${item.status}`) }));
  if (v.cancelled) lines.push(t.t("ical.description.note.cancelled"));
  else if (v.postponed) lines.push(t.t("ical.description.note.postponed"));
  else if (v.precision === "month" || v.precision === "quarter" || v.precision === "year") {
    lines.push(t.t(`ical.description.note.${v.precision}`));
  }
  if (url) lines.push(t.t("ical.description.detail", { value: url }));
  lines.push(t.t("ical.description.attribution"));
  return lines.join("\n");
}

function calendarTexts(t: Translator, feed: IcalGenerateInput["feed"]): { name: string; description: string } {
  switch (feed.kind) {
    case "events":
      return { name: t.t("ical.calendarName.events"), description: t.t("ical.calendarDescription.events") };
    case "platform": {
      const platform = feed.platformName ?? "";
      return {
        name: t.t("ical.calendarName.platform", { platform }),
        description: t.t("ical.calendarDescription.platform", { platform }),
      };
    }
    case "game": {
      const game = feed.gameName ?? "";
      return { name: t.t("ical.calendarName.game", { game }), description: t.t("ical.calendarDescription.game", { game }) };
    }
    default:
      return { name: t.t("ical.calendarName.releases"), description: t.t("ical.calendarDescription.releases") };
  }
}

/** 輸出順序：日期（舊到新）→ 遊戲 → 平台 → 階段，最後以 UID 保底，同樣的輸入永遠同樣的順序。 */
function compareViews(a: ReleaseView, b: ReleaseView): number {
  return (
    a.date.localeCompare(b.date) ||
    a.item.gameId - b.item.gameId ||
    a.item.platformId - b.item.platformId ||
    stageRank(a.item.stage) - stageRank(b.item.stage)
  );
}

export function generateIcs(input: IcalGenerateInput): string {
  const { locale, uidDomain } = input;
  const t = createTranslator(locale);
  const texts = calendarTexts(t, input.feed);
  const cal = ical({
    name: input.feed.calendarName ?? texts.name,
    description: texts.description,
    prodId: { company: "SoK Studio", product: "Game Calendar", language: "EN" },
    ttl: ICAL_REFRESH_SECONDS,
  });

  const views = input.releases.map(viewOf).filter((v): v is ReleaseView => v !== null).sort(compareViews);
  for (const v of views) {
    const day = utcDate(v.date);
    if (!day) continue;
    const span = v.precision === "month" ? monthSpan(day) : { start: day, end: addDays(day, 1) };
    const url = input.links.game(v.item.gameSlug);
    cal.createEvent({
      id: releaseUid(v.item, uidDomain),
      allDay: true,
      start: span.start,
      end: span.end,
      summary: summaryOf(t, v, locale),
      description: releaseDescription(t, v, url),
      url,
      sequence: v.item.sequence,
      stamp: v.item.updatedAt,
      lastModified: v.item.updatedAt,
      status: v.cancelled ? ICalEventStatus.CANCELLED : v.postponed ? ICalEventStatus.TENTATIVE : null,
      transparency: ICalEventTransparency.TRANSPARENT,
    });
  }

  const events = [...input.events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime() || a.id - b.id);
  for (const e of events) {
    const start = e.startTime;
    const rawEnd = e.endTime ?? new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    const end = rawEnd.getTime() > start.getTime() ? rawEnd : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    const url = input.links.event(e.slug);
    const lines = [t.t("ical.description.kind", { value: t.t(`enums.eventKind.${e.kind}`) })];
    if (e.organizer) lines.push(t.t("ical.description.organizer", { value: e.organizer }));
    if (e.streamUrl) lines.push(t.t("ical.description.stream", { value: e.streamUrl }));
    if (url) lines.push(t.t("ical.description.detail", { value: url }));
    if (e.description?.trim()) lines.push("", e.description.trim());
    lines.push("", t.t("ical.description.attribution"));
    cal.createEvent({
      id: eventUid(e.id, uidDomain),
      start,
      end,
      summary: e.name,
      description: lines.join("\n"),
      url: url ?? e.url,
      sequence: e.sequence,
      stamp: e.updatedAt,
      lastModified: e.updatedAt,
      transparency: ICalEventTransparency.TRANSPARENT,
    });
  }
  return cal.toString();
}
