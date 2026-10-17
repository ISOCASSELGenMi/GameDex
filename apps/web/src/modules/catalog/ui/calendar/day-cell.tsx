"use client";
/**
 * 月曆一格（一個日期一款遊戲，參考 gamecalendar.app）。
 * - 伺服器首屏只送當天第一款；同日還有其他款時，使用者第一次切換才呼叫 day API 載入全部（之後在記憶體內切換）。
 * - 切換方式：左右按鈕、鍵盤左右鍵（焦點在格內時）、觸控橫向滑動。到頭尾會繞回另一端。
 * - 格底的點點指示第幾款（款數多時改成「3 / 24」文字）。目前那款由 aria-live="polite" 宣告。
 * - 無障礙：整格是 role=group（名稱＝日期＋款數）；款數 > 1 的格是 Tab 停駐點，Tab 進格後內部控制項才進 Tab 順序
 *   （避免整月上百個停駐點）；左右鍵在格內任何位置都能切換。
 * - 動畫（滑入）只存在於 CSS 的 prefers-reduced-motion: no-preference；此元件沒有任何時間性的動畫邏輯。
 */
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { CardActionHost } from "../card-action-host";
import { StageIcon, StatusIcon, WarningIcon } from "../icons";
import { CalendarCellConfigContext, useCalendarSheet } from "./sheet-context";
import type { CalendarDayResponse, DayCardData } from "./types";

/** 款數不超過這個數字用點點，超過改用「3 / 24」。 */
export const DAY_DOTS_MAX = 6;

const SWIPE_MIN_PX = 40;

const dayCache = new Map<string, Promise<CalendarDayResponse>>();

function loadDay(url: string): Promise<CalendarDayResponse> {
  let p = dayCache.get(url);
  if (!p) {
    p = fetch(url, { headers: { Accept: "application/json" } }).then((res) => {
      if (!res.ok) throw new Error(`day ${res.status}`);
      return res.json() as Promise<CalendarDayResponse>;
    });
    dayCache.set(url, p);
    p.catch(() => dayCache.delete(url));
  }
  return p;
}

const noopSubscribe = () => () => {};

function localTodayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

function ChevronIcon({ dir }: { dir: "prev" | "next" }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
}

function isModified(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export interface DayCellProps {
  date: string;
  /** 日期數字（1~31） */
  dayNum: number;
  /** 星期的短名稱（窄螢幕的逐日清單才顯示） */
  weekday: string;
  /** 群組的可及名稱（日期＋款數） */
  ariaLabel: string;
  /** 當日上市總數（不含活動） */
  total: number;
  /** 第一款；當天沒有上市則為 null */
  first: DayCardData | null;
  /** 當天的活動清單（伺服器渲染） */
  children?: ReactNode;
}

export function DayCell({ date, dayNum, weekday, ariaLabel, total, first, children }: DayCellProps): ReactElement {
  const sheet = useCalendarSheet();
  const config = useContext(CalendarCellConfigContext);
  if (!config) throw new Error("DayCell 必須放在 CalendarInteractive 裡");
  const { apiBase, labels } = config;
  const rootRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<DayCardData[]>(first ? [first] : []);
  const [count, setCount] = useState(total);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"none" | "next" | "prev">("none");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [engaged, setEngaged] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  // 「今天」以使用者裝置的日期判斷（伺服器輸出不含今天，頁面可被共用快取）；伺服器端與水合時為空字串
  const today = useSyncExternalStore(noopSubscribe, localTodayIso, () => "");
  const isToday = today === date;

  // 切換控制項只在水合後出現：沒有 JS 時只有第一款與詳情連結（按鈕沒有作用，不放）
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const multi = count > 1 && hydrated;
  // 內部控制項是否在 Tab 順序內：單款的格（沒有群組停駐點）一律在；多款的格要先 Tab 進格
  const innerTab = !multi || engaged;
  const card = cards[index] ?? null;

  // 追蹤按鈕由 accounts 的 portal 放進掛載點；它的 tabindex 與上面的規則一致（card-follow-layer 讀 data-engaged）
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>("[data-card-action-game] button").forEach((b) => {
      b.tabIndex = innerTab ? 0 : -1;
    });
  }, [innerTab, index, cards]);

  const currentLabel = labels.current;
  const go = useCallback(
    async (delta: 1 | -1) => {
      if (count < 2 || busy) return;
      const target = (index + delta + count) % count;
      let list = cards;
      if (target >= list.length) {
        setBusy(true);
        setFailed(false);
        try {
          const res = await loadDay(`${apiBase}&date=${date}`);
          list = res.cards;
          setCards(res.cards);
          setCount(res.cards.length);
        } catch {
          setFailed(true);
          setBusy(false);
          return;
        }
        setBusy(false);
      }
      if (list.length === 0) return;
      const next = Math.min(target, list.length - 1);
      setDir(delta === 1 ? "next" : "prev");
      setIndex(next);
      setAnnounce(fill(currentLabel, { name: list[next]!.n, index: next + 1, total: list.length }));
    },
    [apiBase, busy, cards, count, currentLabel, date, index],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!multi || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void go(-1);
      }
    },
    [go, multi],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || !multi) return;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped.current = true;
      setTimeout(() => {
        swiped.current = false;
      }, 80);
      void go(dx < 0 ? 1 : -1);
    }
  };

  const onLinkClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (swiped.current) {
      e.preventDefault();
      return;
    }
    if (isModified(e) || !card || !sheet) return;
    e.preventDefault();
    sheet.openCard(card, e.currentTarget);
  };

  const prevIndex = ((index - 1 + count) % count) + 1;
  const nextIndex = ((index + 1) % count) + 1;
  const showDots = count <= DAY_DOTS_MAX;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      aria-current={isToday ? "date" : undefined}
      tabIndex={multi ? 0 : undefined}
      className={`cal-cell${isToday ? " is-today" : ""}${card ? " has-card" : ""}`}
      data-cal-cell=""
      data-date={date}
      data-count={count}
      data-hydrated={hydrated ? "true" : undefined}
      data-index={index}
      data-engaged={innerTab ? "true" : "false"}
      onKeyDown={onKeyDown}
      onFocus={() => setEngaged(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false);
      }}
    >
      <div className="cal-box">
        <div
          className="cal-viewport"
          aria-busy={busy || undefined}
          data-loading={busy ? "true" : undefined}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          {card ? (
            <a
              key={`${card.id}-${index}`}
              className="cal-link"
              href={card.h}
              data-day-card={card.id}
              data-dir={dir === "none" ? undefined : dir}
              tabIndex={innerTab ? undefined : -1}
              onClick={onLinkClick}
            >
              {card.c ? (
                // 封面網址已由 Provider 解析成 CDN 的縮放尺寸（等同 next/image 的 unoptimized），用原生 img 省掉每格約 150 位元組的 inline style 與 data 屬性
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cal-cover" src={card.c} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="cal-cover cal-cover-empty" aria-hidden="true" />
              )}
              <span className="cal-scrim" aria-hidden="true" />
              <span className="cal-info">
                <span className="cal-name" lang={card.nl}>
                  {card.n}
                </span>
                {card.pc.length > 0 ? (
                  <span className="cal-chips">
                    {card.pc.map((p, i) => (
                      <span key={i} className="cal-chip">
                        {p}
                      </span>
                    ))}
                    {card.pn ? <span className="cal-chip">+{card.pn}</span> : null}
                  </span>
                ) : null}
                {card.tg.length > 0 || card.hl ? (
                  <span className="cal-tags">
                    {card.hl ? (
                      <span className="cal-heat" role="img" aria-label={card.hl} title={card.hl} data-heat={card.hv}>
                        <span aria-hidden="true">{card.hv}</span>
                      </span>
                    ) : null}
                    {card.tg.map((tag, i) => (
                      <span key={i} className={`cal-tag cal-tag-${tag.k}`} data-tag={tag.k}>
                        {tag.k === "stage" ? <StageIcon stage={tag.i ?? ""} /> : tag.k === "status" ? <StatusIcon status={tag.i ?? ""} /> : tag.k === "warn" ? <WarningIcon /> : null}
                        <span>{tag.l}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </a>
          ) : (
            <span className="cal-blank" aria-hidden="true" />
          )}
        </div>

        <span className="cal-daynum" aria-hidden="true">
          <span className="cal-daynum-n">{dayNum}</span>
          <span className="cal-daynum-wd">{weekday}</span>
          {isToday ? <span className="cal-today-tag">{labels.today}</span> : null}
        </span>

        {card ? <CardActionHost key={card.id} gameId={card.id} name={card.n} /> : null}

        {multi ? (
          <>
            <button
              type="button"
              className="cal-nav cal-nav-prev"
              aria-label={fill(labels.prev, { index: prevIndex, total: count })}
              tabIndex={innerTab ? undefined : -1}
              disabled={busy}
              onClick={() => void go(-1)}
              data-cal-nav="prev"
            >
              <ChevronIcon dir="prev" />
            </button>
            <button
              type="button"
              className="cal-nav cal-nav-next"
              aria-label={fill(labels.next, { index: nextIndex, total: count })}
              tabIndex={innerTab ? undefined : -1}
              disabled={busy}
              onClick={() => void go(1)}
              data-cal-nav="next"
            >
              <ChevronIcon dir="next" />
            </button>
            <span className="cal-pos" aria-hidden="true" data-cal-pos="">
              {showDots ? (
                <span className="cal-dots">
                  {Array.from({ length: count }, (_, i) => (
                    <span key={i} className="cal-dot" data-on={i === index ? "true" : undefined} />
                  ))}
                </span>
              ) : (
                <span className="cal-count">
                  {index + 1} / {count}
                </span>
              )}
            </span>
          </>
        ) : null}

        <span className="sr-only" aria-live="polite" aria-atomic="true" data-cal-live="">
          {announce}
        </span>
        {failed ? (
          <p className="cal-error" role="alert">
            {labels.loadError}{" "}
            <button type="button" className="cal-retry" onClick={() => void go(1)}>
              {labels.retry}
            </button>
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
