/**
 * 原型驗證用 feed 的情境（08、15 Phase 5「先做原型驗證」）。
 *
 * 目的：用**同一個產生函式**輸出可控的 ics，讓人用真的 Apple／Google 日曆訂閱，逐步切換情境、觀察客戶端行為：
 * (a) 換地區（同 UID 換地區屬性與日期）是更新還是重複建立；(b) 延期成 tbd 後事件還在並顯示標記；
 * (c) 取消後復原；(d) SEQUENCE 是否被採用。
 *
 * 內容由一份狀態檔（.local/ical-proto/state.json，git 忽略）決定，不讀寫資料庫。這個檔案只有純函式：
 * 狀態形狀、每一步怎麼改狀態、狀態 → ics。檔案讀寫在 apps/web/scripts/ical-proto.ts 與 catalog/api/ical-proto.ts。
 *
 * 兩個 feed 同時存在：
 * - `a`：照 08 的規則，每次變動 SEQUENCE +1。
 * - `b`：對照組，同樣的資料變動但 SEQUENCE 永遠不動。
 * 兩者並排觀察就能知道客戶端是不是依賴 SEQUENCE。
 */
import { z } from "zod";
import type { Locale } from "@sok/i18n";
import type { IcalEventItem, IcalReleaseItem, IsoDate } from "../../domain/entities";
import { generateIcs, type IcalLinkBuilder } from "./generate";

export const PROTO_FEEDS = ["a", "b"] as const;
export type ProtoFeedName = (typeof PROTO_FEEDS)[number];

export const PROTO_STEPS = ["init", "region", "tbd", "cancel", "restore", "seq-only", "no-seq"] as const;
export type ProtoStep = (typeof PROTO_STEPS)[number];

export function isProtoFeedName(v: string): v is ProtoFeedName {
  return (PROTO_FEEDS as readonly string[]).includes(v);
}

export function isProtoStep(v: string): v is ProtoStep {
  return (PROTO_STEPS as readonly string[]).includes(v);
}

const precision = z.enum(["day", "month", "quarter", "year", "tbd"]);
const release = z.object({
  gameId: z.number(),
  gameSlug: z.string(),
  gameName: z.string(),
  platformId: z.number(),
  platformName: z.string(),
  platformAbbreviation: z.string().nullable(),
  stage: z.enum(["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"]),
  regionCode: z.string(),
  date: z.string().nullable(),
  precision,
  status: z.enum(["scheduled", "delayed", "released", "cancelled"]),
  sequence: z.number().int(),
  updatedAt: z.coerce.date(),
  lastKnownDate: z.string().nullable(),
  lastKnownPrecision: precision.nullable(),
});
const event = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["showcase", "expo", "awards", "other"]),
  description: z.string().nullable(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date().nullable(),
  url: z.string().nullable(),
  streamUrl: z.string().nullable(),
  organizer: z.string().nullable(),
  sequence: z.number().int(),
  updatedAt: z.coerce.date(),
});
const feedState = z.object({ releases: z.array(release), events: z.array(event) });
export const protoStateSchema = z.object({
  version: z.literal(1),
  step: z.enum(PROTO_STEPS),
  /** 第幾步（init＝1），寫 log 用。 */
  stepNo: z.number().int(),
  at: z.coerce.date(),
  feeds: z.object({ a: feedState, b: feedState }),
});

export type ProtoState = z.infer<typeof protoStateSchema>;
export type ProtoFeedState = z.infer<typeof feedState>;

export function parseProtoState(raw: unknown): ProtoState {
  return protoStateSchema.parse(raw);
}

// ── 情境 ─────────────────────────────────────────────────────────────────

function isoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 原型專用的遊戲 id／slug（遠離真實資料，UID 不會和正式 feed 撞）。 */
const G = {
  day: { id: 990001, slug: "proto-day-game", name: "Proto Day Game" },
  month: { id: 990002, slug: "proto-month-game", name: "Proto Month Game" },
  quarter: { id: 990003, slug: "proto-quarter-game", name: "Proto Quarter Game" },
  region: { id: 990004, slug: "proto-region-game", name: "Proto Region Game" },
  delay: { id: 990005, slug: "proto-delay-game", name: "Proto Delay Game" },
  cancel: { id: 990006, slug: "proto-cancel-game", name: "Proto Cancel Game" },
  probe: { id: 990007, slug: "proto-seq-probe", name: "Proto Seq Probe" },
} as const;

type GameKey = keyof typeof G;

function baseRelease(key: GameKey, over: Partial<IcalReleaseItem>, now: Date): IcalReleaseItem {
  const g = G[key];
  return {
    gameId: g.id,
    gameSlug: g.slug,
    gameName: g.name,
    platformId: 990100,
    platformName: "Proto Console",
    platformAbbreviation: "PC1",
    stage: "full",
    regionCode: "WW",
    date: null,
    precision: "day",
    status: "scheduled",
    sequence: 0,
    updatedAt: now,
    lastKnownDate: null,
    lastKnownPrecision: null,
    ...over,
  };
}

/** 季精度的代表日期＝期間最後一天；取「從今天算起 60 天後」所在季的最後一天。 */
function quarterEnd(d: Date): IsoDate {
  const q = Math.floor(d.getUTCMonth() / 3);
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)));
}

function firstOfNextMonth(d: Date, plus: number): IsoDate {
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + plus, 1)));
}

export function initialProtoFeed(now: Date): ProtoFeedState {
  const today = startOfUtcDay(now);
  return {
    releases: [
      baseRelease("day", { date: isoDate(addDays(today, 20)) }, now),
      baseRelease("month", { date: firstOfNextMonth(today, 1), precision: "month" }, now),
      baseRelease("quarter", { date: quarterEnd(addDays(today, 60)), precision: "quarter" }, now),
      baseRelease("region", { date: isoDate(addDays(today, 30)), regionCode: "WW" }, now),
      baseRelease("delay", { date: isoDate(addDays(today, 25)) }, now),
      baseRelease("cancel", { date: isoDate(addDays(today, 35)) }, now),
      baseRelease("probe", { date: isoDate(addDays(today, 40)) }, now),
    ],
    events: [
      {
        id: 990001,
        slug: "proto-showcase",
        name: "Proto Showcase",
        kind: "showcase",
        description: null,
        startTime: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 10, 17, 0, 0)),
        endTime: null,
        url: null,
        streamUrl: null,
        organizer: null,
        sequence: 0,
        updatedAt: now,
      },
    ],
  };
}

export interface ProtoStepResult {
  state: ProtoState;
  /** 這一步做了什麼（寫進 log.md）。 */
  change: string;
  /** 預期客戶端行為，供使用者對照實際觀察（寫進 log.md）。 */
  expect: string;
}

type Mutate = (r: IcalReleaseItem, feed: ProtoFeedName) => IcalReleaseItem;

function mapFeeds(state: ProtoState, key: GameKey, now: Date, fn: Mutate): ProtoState["feeds"] {
  const out = {} as ProtoState["feeds"];
  for (const feed of PROTO_FEEDS) {
    out[feed] = {
      events: state.feeds[feed].events,
      releases: state.feeds[feed].releases.map((r) => (r.gameId === G[key].id ? { ...fn(r, feed), updatedAt: now } : r)),
    };
  }
  return out;
}

/** feed a 依規則 +1；feed b 對照組不動。 */
const bumpIfA = (r: IcalReleaseItem, feed: ProtoFeedName): number => (feed === "a" ? r.sequence + 1 : r.sequence);

/**
 * 套用一步。init 之外的步驟需要前一份狀態（沒有 → 丟錯，請先 init）。
 * 每一步改變的項目 updatedAt＝這一步的時間（DTSTAMP／LAST-MODIFIED 隨之改變，和正式資料一致）。
 */
export function applyProtoStep(prev: ProtoState | null, step: ProtoStep, now: Date): ProtoStepResult {
  if (step === "init") {
    const feed = initialProtoFeed(now);
    return {
      state: { version: 1, step, stepNo: 1, at: now, feeds: { a: feed, b: structuredClone(feed) } },
      change:
        "建立 7 個上市項目（day、month、quarter 各一，另 4 個供後續步驟用）＋ 1 個活動；兩個 feed 內容相同。",
      expect:
        "訂閱 a.ics 與 b.ics 後各出現 7 個全天事件與 1 個 1 小時的活動。month 事件橫跨整個月份（最後一天不被吃掉）；" +
        "quarter 事件在該季最後一天、標題有 [暫定 …]。",
    };
  }
  if (!prev) throw new Error("請先執行 init 建立初始狀態");
  const base = { version: 1 as const, step, stepNo: prev.stepNo + 1, at: now };
  switch (step) {
    case "region": {
      const day = (r: IcalReleaseItem) => addDays(new Date(`${r.date}T00:00:00Z`), 3);
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "region", now, (r, feed) => ({
            ...r,
            regionCode: "JP",
            date: isoDate(day(r)),
            sequence: bumpIfA(r, feed),
          })),
        },
        change: "Proto Region Game：地區 WW → JP、日期延後 3 天（同一個 UID，模擬地區偏好切換／聚合挑到別的地區列）。a 的 SEQUENCE +1，b 不動。",
        expect:
          "不應該多出一個重複事件，原本的事件搬到新日期。a 一定要更新；b（沒有 SEQUENCE）若也更新，代表客戶端不依賴 SEQUENCE 只看內容。",
      };
    }
    case "tbd":
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "delay", now, (r, feed) => ({
            ...r,
            status: "delayed",
            precision: "tbd",
            lastKnownDate: r.date,
            lastKnownPrecision: r.precision === "tbd" ? "day" : r.precision,
            date: null,
            sequence: bumpIfA(r, feed),
          })),
        },
        change: "Proto Delay Game：延期成日期未定（tbd）。事件留在原本的日期，標題加延期標記、STATUS:TENTATIVE。a 的 SEQUENCE +1，b 不動。",
        expect: "事件仍在原本的日期，標題多了延期標記，不會消失；觀察 Apple／Google 對 TENTATIVE 的顯示（淡色、問號等）。",
      };
    case "cancel":
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "cancel", now, (r, feed) => ({ ...r, status: "cancelled", sequence: bumpIfA(r, feed) })),
        },
        change: "Proto Cancel Game：取消（STATUS:CANCELLED、標題加取消標記）。a 的 SEQUENCE +1，b 不動。",
        expect: "事件被標示取消（刪除線）或從行事曆消失，不會停在原樣。記錄兩個客戶端各是哪一種。",
      };
    case "restore":
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "cancel", now, (r, feed) => ({ ...r, status: "scheduled", sequence: bumpIfA(r, feed) })),
        },
        change: "Proto Cancel Game：復原（回到 scheduled，取消標記消失）。a 的 SEQUENCE +1，b 不動。",
        expect: "事件恢復正常顯示。若客戶端在取消時把事件刪掉，這裡要確認它會不會重新出現（a 與 b 可能不同）。",
      };
    case "seq-only":
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "probe", now, (r, feed) => ({
            ...r,
            gameName: `${G.probe.name} (rev B)`,
            sequence: bumpIfA(r, feed),
          })),
        },
        change: "Proto Seq Probe：只改標題為「… (rev B)」，日期不變。a 的 SEQUENCE +1，b 不動。",
        expect: "a 的標題應變成 rev B。b 內容同樣改了但沒有 SEQUENCE：若 b 沒更新，代表客戶端依 SEQUENCE 決定是否採用新版本。",
      };
    case "no-seq":
      return {
        state: {
          ...base,
          feeds: mapFeeds(prev, "probe", now, (r) => ({
            ...r,
            date: isoDate(addDays(new Date(`${r.date}T00:00:00Z`), 7)),
          })),
        },
        change: "Proto Seq Probe：日期延後 7 天，a、b 的 SEQUENCE 都**不動**（DTSTAMP／LAST-MODIFIED 仍更新）。",
        expect: "觀察日期有沒有跟著變。若客戶端不更新，代表它只認 SEQUENCE（此時 SEQUENCE 必須遞增才能保證延期被看到）。",
      };
  }
}

/** 狀態 → ics（同一個產生函式）。語系固定一個（由呼叫端決定）。 */
export function renderProtoFeed(
  state: ProtoState,
  feed: ProtoFeedName,
  opts: { locale: Locale; uidDomain: string; links: IcalLinkBuilder },
): string {
  const f = state.feeds[feed];
  return generateIcs({
    locale: opts.locale,
    feed: { kind: "releases", calendarName: feed === "a" ? "SoK proto A (SEQUENCE +1)" : "SoK proto B (SEQUENCE fixed)" },
    releases: f.releases,
    events: f.events as IcalEventItem[],
    uidDomain: opts.uidDomain,
    links: opts.links,
  });
}

