"use client";
/**
 * 時間軸清單（漸進增強）。
 * - 沒有 JS：整頁伺服器渲染；「載入較早／載入更多」是帶 cursor 的連結（整頁導覽）；卡片是詳情頁連結。
 * - 有 JS：同兩個連結攔截成 fetch（/api/timeline）→ 與目前清單合併（同 key 的組併成一組）→ 焦點移到新內容的第一張卡 → role="status" 公告；
 *   「展開（剩 M 款）」按鈕與「改期紀錄」按鈕（aria-expanded）按需載入。不做無限捲動（一律用按鈕，鍵盤與螢幕報讀器都可操作）。
 * 條件（篩選、at）都在網址；本元件的 key 隨條件改變（頁面指定），不會殘留舊狀態。
 */
import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactElement } from "react";
import { HeatBadge } from "../heat-badge";
import { StageIcon, StatusIcon, WarningIcon } from "../icons";
import type { TimelineCardData, TimelineChunk, TimelineClientLabels, TimelineGroupData, TimelineGroupExpansion, TimelineHistoryResponse } from "./types";
import { appendGroupCards, groupByMonth, mergeTimelineChunk, remainingInGroup, todayMarkerIndex } from "./view-model";

export interface TimelineListProps {
  initial: TimelineChunk;
  labels: TimelineClientLabels;
  locale: string;
  /** 帶語系前綴的頁面路徑（`/en/timeline`）。 */
  path: string;
  /** 目前的篩選 query（filterSpecToQueryString，不含 cursor／at）。 */
  baseQuery: string;
  /** 今天（UTC）。 */
  today: string;
  /** 初始頁是從今天開始（未指定 at、或 at＝今天）。 */
  startsAtToday: boolean;
}

function isModified(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

const noopSubscribe = () => () => {};
/** 伺服器輸出與水合時為 false，水合後為 true（沒有 JS 時一直是 false）。 */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function countCards(chunk: TimelineChunk): number {
  return chunk.groups.reduce((n, g) => n + g.cards.length, 0);
}

function cardId(groupKey: string, card: TimelineCardData): string {
  return `tl-c-${groupKey}-${card.k}`;
}

function HistoryToggle({ ids, locale, labels }: { ids: number[]; locale: string; labels: TimelineClientLabels }): ReactElement {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [entries, setEntries] = useState<string[]>([]);

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (!next || state === "loading" || state === "done") return;
    setState("loading");
    try {
      const res = await fetch(`/api/timeline/history?locale=${encodeURIComponent(locale)}&ids=${ids.join(",")}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as TimelineHistoryResponse;
      setEntries(body.entries);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div>
      <button type="button" className="tl-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => void toggle()}>
        {labels.history}
      </button>
      <div id={panelId} hidden={!open} aria-live="polite">
        {open && state === "loading" ? <p className="tl-history">{labels.historyLoading}</p> : null}
        {open && state === "error" ? <p className="tl-history">{labels.historyError}</p> : null}
        {open && state === "done" ? (
          entries.length === 0 ? (
            <p className="tl-history">{labels.historyEmpty}</p>
          ) : (
            <ol className="tl-history list-decimal">
              {entries.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ol>
          )
        ) : null}
      </div>
    </div>
  );
}

function TimelineCard({ card, groupKey, labels, locale, js }: { card: TimelineCardData; groupKey: string; labels: TimelineClientLabels; locale: string; js: boolean }): ReactElement {
  const shown = card.p.slice(0, 3);
  const rest = card.p.length - shown.length;
  return (
    <li className="tl-card" data-timeline-card={card.k}>
      <a id={cardId(groupKey, card)} className="card" href={card.h}>
        {card.c ? <Image className="card-thumb" src={card.c} alt="" width={90} height={128} unoptimized loading="lazy" /> : <span className="card-thumb card-thumb-empty" aria-hidden="true" />}
        <span className="card-body">
          <span className="card-name">{card.n}</span>
          {card.o ? (
            <span className="card-meta" lang="en">
              {card.o}
            </span>
          ) : null}
          {shown.length > 0 ? (
            <span className="chips" title={card.pn}>
              {shown.map((p, i) => (
                <span key={`${p}-${i}`} className="chip">
                  {p}
                </span>
              ))}
              {rest > 0 ? <span className="chip">+{rest}</span> : null}
            </span>
          ) : null}
          <span className="card-meta">
            {card.hv ? <HeatBadge level={card.hv} label={card.hl ?? null} compact /> : null}
            <StageIcon stage={card.sk} />
            <span>{card.s}</span>
            {card.pl ? <span>· {card.pl}</span> : null}
            {card.tk ? (
              <>
                <StatusIcon status={card.tk} />
                <span>{card.t}</span>
              </>
            ) : null}
          </span>
          {card.r ? (
            <span className="card-meta card-warn">
              <WarningIcon />
              <span>{labels.sourceUnconfirmed}</span>
            </span>
          ) : null}
        </span>
      </a>
      {js && card.ids && card.ids.length > 0 ? <HistoryToggle ids={card.ids} locale={locale} labels={labels} /> : null}
    </li>
  );
}

export function TimelineList({ initial, labels, locale, path, baseQuery, today, startsAtToday }: TimelineListProps): ReactElement {
  const [chunk, setChunk] = useState<TimelineChunk>(initial);
  const [busy, setBusy] = useState<"next" | "prev" | { expand: string } | null>(null);
  const [message, setMessage] = useState("");
  const js = useHydrated();
  const busyRef = useRef(false);
  const focusRef = useRef<string | null>(null);
  const offsets = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (focusRef.current) {
      document.getElementById(focusRef.current)?.focus();
      focusRef.current = null;
    }
  }, [chunk]);

  const sections = useMemo(() => groupByMonth(chunk.groups), [chunk.groups]);
  const marker = useMemo(() => todayMarkerIndex(chunk.groups, today, { startsAtToday, hasNext: chunk.nextCursor !== null }), [chunk, today, startsAtToday]);
  const indexOf = useMemo(() => new Map(chunk.groups.map((g, i) => [g.key, i])), [chunk.groups]);

  const hrefFor = (cursor: string) => `${path}?${[baseQuery, `cursor=${encodeURIComponent(cursor)}`].filter(Boolean).join("&")}`;
  const apiBase = `locale=${encodeURIComponent(locale)}${baseQuery ? `&${baseQuery}` : ""}`;

  async function run<T>(kind: "next" | "prev" | { expand: string }, task: () => Promise<T>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(kind);
    setMessage(labels.loading);
    try {
      return await task();
    } catch {
      setMessage(labels.loadError);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function load(dir: "next" | "prev"): Promise<void> {
    const cursor = dir === "next" ? chunk.nextCursor : chunk.prevCursor;
    if (!cursor) return;
    const incoming = await run(dir, async () => {
      const res = await fetch(`/api/timeline?${apiBase}&cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as TimelineChunk;
    });
    if (!incoming) return;
    const merged = mergeTimelineChunk(chunk, incoming, dir);
    const added = countCards(merged) - countCards(chunk);
    const known = new Set(chunk.groups.flatMap((g) => g.cards.map((c) => `${g.key}/${c.k}`)));
    for (const g of merged.groups) {
      const fresh = g.cards.find((c) => !known.has(`${g.key}/${c.k}`));
      if (fresh) {
        focusRef.current = cardId(g.key, fresh);
        break;
      }
    }
    setChunk(merged);
    setMessage(fill(labels.loadedCount, { count: added }));
  }

  async function expand(group: TimelineGroupData): Promise<void> {
    const offset = offsets.current.get(group.key);
    const res = await run({ expand: group.key }, async () => {
      const r = await fetch(`/api/timeline/group?${apiBase}&key=${encodeURIComponent(group.key)}${offset !== undefined ? `&offset=${offset}` : ""}`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as TimelineGroupExpansion;
    });
    if (!res) return;
    const have = new Set(group.cards.map((c) => c.k));
    const fresh = res.cards.find((c) => !have.has(c.k));
    if (fresh) focusRef.current = cardId(group.key, fresh);
    if (res.nextOffset !== null) offsets.current.set(group.key, res.nextOffset);
    setChunk(appendGroupCards(chunk, group.key, res.cards, res.totalCount));
    setMessage(fill(labels.loadedCount, { count: res.cards.length }));
  }

  function onLoadClick(e: MouseEvent, dir: "next" | "prev"): void {
    if (isModified(e) || !js) return;
    e.preventDefault();
    void load(dir);
  }

  const todayLine = (
    <div className="tl-today" id="tl-today" data-today-line>
      <span>{labels.todayDate}</span>
    </div>
  );

  return (
    <div aria-label={labels.listLabel} role="region" data-timeline-root>
      <p role="status" className="sr-only" data-timeline-status>
        {message}
      </p>

      <div className="tl-more">
        {chunk.prevCursor ? (
          <a className="btn-secondary" href={hrefFor(chunk.prevCursor)} rel="prev" onClick={(e) => onLoadClick(e, "prev")} aria-busy={busy === "prev"} data-load="prev">
            {busy === "prev" ? labels.loading : labels.loadEarlier}
          </a>
        ) : (
          <p className="text-sm text-[var(--muted)]">{labels.noEarlier}</p>
        )}
      </div>

      {sections.map((section) => (
        <section key={section.month ?? "tbd"} className="tl-month" aria-labelledby={`tl-m-${section.month ?? "tbd"}`}>
          <h2 id={`tl-m-${section.month ?? "tbd"}`}>{section.title}</h2>
          {section.groups.map((g) => {
            const remaining = remainingInGroup(g);
            const expanding = typeof busy === "object" && busy !== null && busy.expand === g.key;
            return (
              <div key={g.key}>
                {marker === indexOf.get(g.key) ? todayLine : null}
                <div className="tl-group" data-group={g.key}>
                  <h3 id={`tl-g-${g.key}`}>{g.title}</h3>
                  <ul className="tl-cards" aria-labelledby={`tl-g-${g.key}`}>
                    {g.cards.map((c) => (
                      <TimelineCard key={c.k} card={c} groupKey={g.key} labels={labels} locale={locale} js={js} />
                    ))}
                  </ul>
                  {js && remaining > 0 ? (
                    <button
                      type="button"
                      className="btn-secondary mt-2"
                      aria-label={fill(labels.expandAria, { group: g.title, count: remaining })}
                      aria-busy={expanding}
                      onClick={() => void expand(g)}
                      data-expand={g.key}
                    >
                      {expanding ? labels.loading : fill(labels.expand, { count: remaining })}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {marker === chunk.groups.length ? todayLine : null}

      <div className="tl-more">
        {chunk.nextCursor ? (
          <a className="btn-secondary" href={hrefFor(chunk.nextCursor)} rel="next" onClick={(e) => onLoadClick(e, "next")} aria-busy={busy === "next"} data-load="next">
            {busy === "next" ? labels.loading : labels.loadMore}
          </a>
        ) : (
          <p className="text-sm text-[var(--muted)]">{labels.noLater}</p>
        )}
      </div>
    </div>
  );
}
