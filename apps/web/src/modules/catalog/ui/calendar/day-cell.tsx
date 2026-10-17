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
import { useContext, useEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { CardActionHost } from "../card-action-host";
import { ChevronIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { CalendarCellConfigContext, useCalendarSheet } from "./sheet-context";
import type { DayCardData } from "./types";
import { fillTemplate as fill, useDayCards, useLocalToday } from "./use-day-cards";

/** 款數不超過這個數字用點點，超過改用「3 / 24」。 */
export const DAY_DOTS_MAX = 6;

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
  const [engaged, setEngaged] = useState(false);
  const { cards, card, count, index, dir, busy, failed, announce, hydrated, multi, go, onKeyDown, onPointerDown, onPointerUp, onPointerCancel, swiped } = useDayCards({
    date,
    apiBase,
    first,
    total,
    currentLabel: labels.current,
  });

  // 「今天」以使用者裝置的日期判斷（伺服器輸出不含今天，頁面可被共用快取）；伺服器端與水合時為空字串
  const today = useLocalToday();
  const isToday = today === date;

  // 內部控制項是否在 Tab 順序內：單款的格（沒有群組停駐點）一律在；多款的格要先 Tab 進格
  const innerTab = !multi || engaged;

  // 追蹤按鈕由 accounts 的 portal 放進掛載點；它的 tabindex 與上面的規則一致（card-follow-layer 讀 data-engaged）
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>("[data-card-action-game] button").forEach((b) => {
      b.tabIndex = innerTab ? 0 : -1;
    });
  }, [innerTab, index, cards]);

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
          onPointerCancel={onPointerCancel}
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
