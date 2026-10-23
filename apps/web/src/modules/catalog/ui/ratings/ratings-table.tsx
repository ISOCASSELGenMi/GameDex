"use client";
/**
 * 評分排名表（06 §評分排名；ui-direction「評分排名分頁」）。
 * - 真正的 <table>；可排序欄位的標題是 <button>，active 欄的 <th> 帶 aria-sort。點同一欄切換升降冪，換欄先降冪。
 * - 點標題 → fetch /api/v1/ratings/ranking（帶 prev＝上一個排序欄，伺服器算每列在上一欄的名次）→ 換列＋FLIP：
 *   只動 transform（WAAPI，250ms、cubic-bezier(0.77, 0, 0.175, 1)）；可被下一次點擊中斷並從目前位置接續（先量目前位置再 cancel）；
 *   視窗（上下各留 1/4 視窗高）以外的列直接就位；新進的列淡入 150ms；位移結束後名次升降標示（▲3／▼2）淡入 150ms。
 * - prefers-reduced-motion: reduce 或鍵盤觸發（Enter／Space）：不做位移與淡入，名次升降標示立即出現。
 * - 排序狀態寫進網址（history.replaceState，可分享）；結果數與排序以 role="status"（aria-live polite）宣告。
 * - 載入更多：附加下一頁（沒有 JS 時是一般連結，page+1）。
 * 容器可橫向捲動（320px 時頁面本身不溢出）；容器是 role="region"＋tabindex 0，鍵盤可捲動。
 */
import Image from "next/image";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { shouldAnimateRow } from "../../domain/ratings-ranking";
import { ariaSortValue, nextSort, ratingsQuery, rankMark, type RatingsClientColumn, type RatingsClientRow, type RatingsRankingResponse } from "./view-model";

export interface RatingsTableStrings {
  caption: string;
  regionLabel: string;
  rank: string;
  game: string;
  noScore: string;
  /** 含 `{total}` `{column}` `{direction}`。 */
  status: string;
  dirDesc: string;
  dirAsc: string;
  loadMore: string;
  loadMoreHref: string;
  loadError: string;
  empty: string;
  /** 含 `{n}` `{prev}`。 */
  rankUp: string;
  rankDown: string;
  /** 含 `{n}`（載入更多後的宣告）。 */
  loaded: string;
}

export interface RatingsTableProps {
  locale: string;
  /** Intl 用的語言標籤（例如 zh-Hant）。 */
  numberLocale: string;
  columns: RatingsClientColumn[];
  initial: RatingsRankingResponse;
  /** 篩選的正規 query（不含 ?）。 */
  filterQuery: string;
  /** 使用者明確指定的最低票數（網址上有才有）。 */
  minVotesParam?: number;
  /** `/en/games/`：與 slug 組成詳情連結。 */
  gameBase: string;
  /** `/en/ratings`（不含 query）。 */
  pagePath: string;
  initialStatus: string;
  /** 網址一開始就帶 sort／dir（載入更多改網址時保留；沒帶就不寫預設值）。 */
  explicitSort?: boolean;
  strings: RatingsTableStrings;
}

const FLIP_MS = 250;
const FLIP_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";
const FADE_MS = 150;

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

interface TableData {
  sort: string;
  dir: "asc" | "desc";
  total: number;
  page: number;
  hasMore: boolean;
  rows: RatingsClientRow[];
  /** 最近一次換排序前的排序欄（載入更多時沿用，附加的列也有名次升降）。 */
  prevSort: string | null;
}

export function RatingsTable(props: RatingsTableProps): ReactElement {
  const { columns, strings: s, numberLocale } = props;
  const [data, setData] = useState<TableData>({
    sort: props.initial.sort,
    dir: props.initial.dir,
    total: props.initial.total,
    page: props.initial.page,
    hasMore: props.initial.hasMore,
    rows: props.initial.rows,
    prevSort: null,
  });
  const [busy, setBusy] = useState<"sort" | "more" | null>(null);
  const [status, setStatus] = useState(props.initialStatus);
  const [markersShown, setMarkersShown] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  /** 網址上是否已有 sort／dir：使用者點過標題、或一開始就帶著。 */
  const explicit = useRef(props.explicitSort === true);
  const rowEls = useRef(new Map<number, HTMLTableRowElement>());
  const pending = useRef<{ before: Map<number, DOMRect>; instant: boolean } | null>(null);
  const running = useRef<Animation[]>([]);
  const nf = useMemo(() => new Intl.NumberFormat(numberLocale), [numberLocale]);
  const nf1 = useMemo(() => new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [numberLocale]);

  const columnLabel = useCallback((id: string) => columns.find((c) => c.id === id)?.label ?? id, [columns]);
  const statusText = useCallback(
    (sort: string, dir: "asc" | "desc", total: number) =>
      fill(s.status, { total: nf.format(total), column: columnLabel(sort), direction: dir === "desc" ? s.dirDesc : s.dirAsc }),
    [s, columnLabel, nf],
  );

  // 換列後（DOM 已更新、繪製前）：依換列前量到的位置做 FLIP
  useLayoutEffect(() => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    const vh = window.innerHeight;
    const anims: Animation[] = [];
    rowEls.current.forEach((el, id) => {
      const old = job.before.get(id);
      const now = el.getBoundingClientRect();
      if (!old) {
        // 新進的列：只有在視窗內的才淡入，視窗外直接就位
        if (!job.instant && shouldAnimateRow(now.top, now.bottom, now.top, now.bottom, vh, vh / 4)) anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" }));
        return;
      }
      const dy = old.top - now.top;
      if (job.instant || Math.abs(dy) < 1) return;
      if (!shouldAnimateRow(old.top, old.bottom, now.top, now.bottom, vh, vh / 4)) return;
      anims.push(el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: FLIP_MS, easing: FLIP_EASING }));
    });
    running.current = anims;
    if (anims.length === 0) {
      setMarkersShown(true);
      return;
    }
    void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
      if (running.current === anims) {
        running.current = [];
        setMarkersShown(true);
      }
    });
  }, [data.rows]);

  /** 換列前：量目前位置（含進行中的位移）→ 取消進行中的動畫。 */
  const snapshot = useCallback((instant: boolean) => {
    const before = new Map<number, DOMRect>();
    rowEls.current.forEach((el, id) => before.set(id, el.getBoundingClientRect()));
    running.current.forEach((a) => a.cancel());
    running.current = [];
    pending.current = { before, instant };
  }, []);

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** 篩選面板裡伺服器渲染的排序／方向選單跟著表格目前的排序（否則之後送出篩選會把排序改回載入時的值）。 */
  function syncSortFields(sort: string, dir: string): void {
    for (const [name, value] of [["sort", sort], ["dir", dir]] as const) {
      document.querySelectorAll<HTMLSelectElement>(`select[name="${name}"]`).forEach((el) => {
        el.value = value;
      });
    }
  }

  const apiUrl = useCallback(
    (sort: string, dir: "asc" | "desc", opts: { page: number; chunk: boolean; prev: string | null }) => {
      const q = ratingsQuery({ filterQuery: props.filterQuery, sort, dir, minVotes: props.minVotesParam, page: opts.page });
      const prev = opts.prev && opts.prev !== sort ? `&prev=${encodeURIComponent(opts.prev)}` : "";
      return `/api/v1/ratings/ranking?locale=${encodeURIComponent(props.locale)}&${q}${opts.chunk ? "&chunk=1" : ""}${prev}`;
    },
    [props.filterQuery, props.locale, props.minVotesParam],
  );

  async function onSort(e: MouseEvent<HTMLButtonElement>, columnId: string): Promise<void> {
    const viaKeyboard = e.detail === 0;
    const next = nextSort({ sort: data.sort, dir: data.dir }, columnId);
    const mine = ++seq.current;
    setBusy("sort");
    setFailed(false);
    try {
      const res = await fetch(apiUrl(next.sort, next.dir, { page: 1, chunk: false, prev: data.sort }));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as RatingsRankingResponse;
      if (mine !== seq.current) return; // 之後又點了別的：丟掉這份
      const instant = viaKeyboard || reduced();
      snapshot(instant);
      setMarkersShown(instant);
      setData({
        sort: body.sort,
        dir: body.dir,
        total: body.total,
        page: body.page,
        hasMore: body.hasMore,
        rows: body.rows,
        prevSort: data.sort !== body.sort ? data.sort : data.prevSort,
      });
      setStatus(statusText(body.sort, body.dir, body.total));
      explicit.current = true;
      syncSortFields(body.sort, body.dir);
      const q = ratingsQuery({ filterQuery: props.filterQuery, sort: body.sort, dir: body.dir, minVotes: props.minVotesParam });
      window.history.replaceState(window.history.state, "", q ? `${props.pagePath}?${q}` : props.pagePath);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  }

  async function onMore(e: MouseEvent<HTMLAnchorElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const mine = ++seq.current;
    setBusy("more");
    setFailed(false);
    try {
      const nextPage = data.page + 1;
      const res = await fetch(apiUrl(data.sort, data.dir, { page: nextPage, chunk: true, prev: data.prevSort }));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as RatingsRankingResponse;
      if (mine !== seq.current) return;
      const have = new Set(data.rows.map((r) => r.id));
      const added = body.rows.filter((r) => !have.has(r.id));
      snapshot(reduced());
      setData({ ...data, page: nextPage, hasMore: body.hasMore, rows: [...data.rows, ...added] });
      setStatus(fill(s.loaded, { n: added.length }));
      const keep = explicit.current ? { sort: data.sort, dir: data.dir } : {};
      const q = ratingsQuery({ filterQuery: props.filterQuery, ...keep, minVotes: props.minVotesParam, page: nextPage });
      window.history.replaceState(window.history.state, "", `${props.pagePath}?${q}`);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  }

  const fmtCell = (score: number, scale: "hundred" | "ten") =>
    scale === "ten" ? nf1.format(Math.round(score) / 10) : nf.format(Math.round(score));
  const colCount = 2 + columns.length;

  return (
    <div>
      <p role="status" aria-live="polite" className="rk-status" data-rk-status>
        {status}
      </p>
      <div className="rk-wrap" role="region" aria-label={s.regionLabel} tabIndex={0}>
        <table className="rk-table" aria-busy={busy === "sort"} data-rk-table>
          <caption className="sr-only">{s.caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="rk-th-rank">
                {s.rank}
              </th>
              <th scope="col" className="rk-th-game">
                {s.game}
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="rk-th-num" aria-sort={ariaSortValue(c.id, data.sort, data.dir)}>
                  <button type="button" className="rk-sort" data-sort={c.id} data-active={c.id === data.sort} onClick={(e) => void onSort(e, c.id)}>
                    <span>{c.label}</span>
                    <span className="rk-caret" aria-hidden="true">
                      {c.id === data.sort ? (data.dir === "desc" ? "▼" : "▲") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="rk-empty">
                  {s.empty}
                </td>
              </tr>
            ) : null}
            {data.rows.map((r) => {
              const mark = rankMark(r);
              return (
                <tr
                  key={r.id}
                  data-rk-row={r.slug}
                  ref={(el) => {
                    if (el) rowEls.current.set(r.id, el);
                    else rowEls.current.delete(r.id);
                  }}
                >
                  <td className="rk-rank">
                    <span className="rk-rank-n">{nf.format(r.rank)}</span>
                    {mark.kind === "up" || mark.kind === "down" ? (
                      <span className="rk-delta" data-kind={mark.kind} data-show={markersShown} data-rk-delta={mark.kind}>
                        <span aria-hidden="true">
                          {mark.kind === "up" ? "▲" : "▼"}
                          {nf.format(mark.amount)}
                        </span>
                        <span className="sr-only">{fill(mark.kind === "up" ? s.rankUp : s.rankDown, { n: mark.amount, prev: r.prevRank ?? "" })}</span>
                      </span>
                    ) : null}
                  </td>
                  <th scope="row" className="rk-game">
                    <a href={`${props.gameBase}${encodeURIComponent(r.slug)}`} className="rk-game-link">
                      {r.cover ? (
                        <Image className="rk-thumb" src={r.cover} alt="" width={36} height={51} unoptimized loading="lazy" />
                      ) : (
                        <span className="rk-thumb card-thumb-empty" aria-hidden="true" />
                      )}
                      <span className="rk-name">
                        <span className="rk-title" lang={r.lang}>
                          {r.name}
                        </span>
                        {r.year !== null ? <span className="rk-year">{r.year}</span> : null}
                      </span>
                    </a>
                  </th>
                  {columns.map((c) => {
                    const cell = r.cells[c.id];
                    return (
                      <td key={c.id} className="rk-num" data-col={c.id}>
                        {cell && cell.score !== null ? (
                          <>
                            <span className="rk-score">{fmtCell(cell.score, c.scale)}</span>
                            {cell.count !== null ? <span className="rk-count">{fill(c.countLabel, { count: nf.format(cell.count) })}</span> : null}
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{s.noScore}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {failed ? (
        <p role="alert" className="rk-error">
          {s.loadError}
        </p>
      ) : null}
      {data.hasMore ? (
        <p className="rk-more">
          <a className="btn-secondary" href={s.loadMoreHref} onClick={(e) => void onMore(e)} aria-disabled={busy === "more"} data-rk-more>
            {s.loadMore}
          </a>
        </p>
      ) : null}
    </div>
  );
}
