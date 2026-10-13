import { EVENT_KINDS, EVENT_LIST_SCOPES, type EventKind, type EventList, type EventListScope } from "../../domain/entities";
import { listEventsPage } from "../../repository/event-pages";

export const EVENT_LIST_DEFAULT_PAGE_SIZE = 30;
export const EVENT_LIST_MAX_PAGE_SIZE = 100;
const MAX_PAGE = 500;

export interface ListEventsInput {
  /** upcoming（預設，含進行中）／past／undated；未知值視為預設。 */
  scope?: string | null;
  /** showcase／expo／awards／other（events.kind）；未給或未知值＝全部。 */
  type?: string | null;
  /** 1 起算；預設 1，上限 500。 */
  page?: number | null;
  /** 預設 30，上限 100。 */
  pageSize?: number | null;
  /** 「現在」；測試用，預設資料庫 now()。 */
  now?: Date;
}

/**
 * 活動列表（06 §活動 /events）：upcoming 條件 COALESCE(end_time, start_time) ≥ now（含進行中），開始時間舊到新；
 * past 開始時間新到舊；undated（start_time NULL，「時間未定」）依名稱。逾時丟 CatalogQueryTimeoutError。
 */
export async function listEvents(input: ListEventsInput = {}): Promise<EventList> {
  const s = input.scope?.trim().toLowerCase();
  const scope: EventListScope = s && (EVENT_LIST_SCOPES as readonly string[]).includes(s) ? (s as EventListScope) : "upcoming";
  const t = input.type?.trim().toLowerCase();
  const kind: EventKind | null = t && (EVENT_KINDS as readonly string[]).includes(t) ? (t as EventKind) : null;
  const pageSize = clampInt(input.pageSize, 1, EVENT_LIST_MAX_PAGE_SIZE, EVENT_LIST_DEFAULT_PAGE_SIZE);
  const page = clampInt(input.page, 1, MAX_PAGE, 1);
  const res = await listEventsPage({ scope, kind, limit: pageSize, offset: (page - 1) * pageSize, now: input.now });
  return { scope, kind, page, pageSize, hasMore: res.hasMore, items: res.items };
}

function clampInt(v: number | null | undefined, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(v) ? Math.floor(v as number) : fallback;
  return Math.min(max, Math.max(min, n));
}
