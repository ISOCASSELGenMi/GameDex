"use client";
/**
 * 時間軸（週）：垂直中軸，每個發售日一張封面卡片，左右交錯掛在中軸上（窄螢幕：中軸靠左、卡片都在右側）。
 * - 沒有 JS 時：上一週／下一週／回到今天是一般連結（整頁導覽）、跳日期是 GET 表單；每天只有第一款的詳情連結。
 * - 有 JS 時：切週改成呼叫 `/api/v1/timeline/week` 就地換內容（新內容以 CSS 動畫進場）、更新網址（pushState）、
 *   完成後由 aria-live 宣告；焦點留在按下的控制項上。瀏覽器上一頁／下一頁與「從別頁回來」也會依網址同步。
 * - 同日多款：沿用月曆的 useDayCards（按需呼叫 day API，其餘款數不隨頁面送出）。
 * - 動畫只存在於 CSS 的 prefers-reduced-motion: no-preference；此元件沒有時間性的動畫邏輯。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { CardActionHost } from "../card-action-host";
import { ChevronIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { DAY_DOTS_MAX } from "../calendar/day-cell";
import { fillTemplate as fill, useDayCards } from "../calendar/use-day-cards";
import { explicitWeekStart, isoWeekOf } from "./week";
import type {
  TimelineWeekData,
  TimelineWeekLabels,
  WeekDayData,
} from "./week-types";
function isModified(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

type Dir = "none" | "next" | "prev";

export interface TimelineWeekProps {
  initial: TimelineWeekData;
  labels: TimelineWeekLabels;
  /** `/api/v1/timeline/week?locale=…&<篩選>`（不含 week／at）。 */
  weekApiBase: string;
  /** `/api/v1/calendar/day?locale=…&<篩選>`（不含 date）。 */
  dayApiBase: string;
  /** 跳日期表單的 action 與要保留的篩選欄位。 */
  basePath: string;
  hiddenFilter: ReadonlyArray<readonly [string, string]>;
}

export function TimelineWeek({
  initial,
  labels,
  weekApiBase,
  dayApiBase,
  basePath,
  hiddenFilter,
}: TimelineWeekProps): ReactElement {
  const [data, setData] = useState(initial);
  const [dir, setDir] = useState<Dir>("none");
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const current = useRef(initial);
  useEffect(() => {
    current.current = data;
  }, [data]);

  const load = useCallback(
    async (
      target: { week?: string; at?: string },
      how: { push: boolean; fallbackHref: string; dir?: Dir },
    ) => {
      const mine = ++seq.current;
      setBusy(true);
      setFailed(false);
      try {
        const qs = [
          target.week ? `week=${encodeURIComponent(target.week)}` : "",
          target.at ? `at=${encodeURIComponent(target.at)}` : "",
        ]
          .filter(Boolean)
          .map((p) => `&${p}`)
          .join("");
        const res = await fetch(`${weekApiBase}${qs}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`week ${res.status}`);
        const next = (await res.json()) as TimelineWeekData;
        if (mine !== seq.current) return;
        const direction: Dir =
          how.dir ??
          (next.start > current.current.start
            ? "next"
            : next.start < current.current.start
              ? "prev"
              : "none");
        setDir(direction);
        setData(next);
        setAnnounce(next.announce);
        if (how.push) window.history.pushState(null, "", next.href);
      } catch {
        if (mine !== seq.current) return;
        // 取不到就退回整頁導覽（等同沒有 JS 的行為）
        setFailed(true);
        window.location.assign(how.fallbackHref);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [weekApiBase],
  );

  // 依目前網址同步（上一頁／下一頁，或從別頁回到 pushState 過的網址時，伺服器送來的是最初那一週）
  const syncFromLocation = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    // 與伺服器同一份規則：網址代表哪一週（week 合法 → at → 今天）；不合法的值不會觸發載入
    const target = explicitWeekStart(params.get("week"), params.get("at"));
    const how = { push: false, fallbackHref: window.location.href };
    if (target) {
      const week = isoWeekOf(target);
      if (week && target !== current.current.start)
        void load({ week, at: target }, how);
    } else if (!current.current.todayInWeek) void load({}, how);
  }, [load]);

  useEffect(() => {
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [syncFromLocation]);

  const onWeekLink = (
    e: MouseEvent<HTMLAnchorElement>,
    target: { week?: string },
    href: string,
  ) => {
    if (isModified(e)) return;
    e.preventDefault();
    void load(target, { push: true, fallbackHref: href });
  };

  const onJump = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("at") ?? "");
    const href = `${basePath}?${new URLSearchParams([...hiddenFilter.map(([k, v]) => [k, v] as [string, string]), ["at", value]]).toString()}`;
    void load(/^\d{4}-\d{2}-\d{2}$/.test(value) ? { at: value } : {}, {
      push: true,
      fallbackHref: href,
    });
  };

  const todayIdx = data.todayInWeek
    ? (() => {
        const i = data.days.findIndex((d) => d.date >= data.today);
        return i === -1 ? data.days.length : i;
      })()
    : -1;

  return (
    <div
      className="tw"
      data-timeline-root=""
      data-busy={busy ? "true" : undefined}
    >
      <nav aria-label={labels.weekNavigation} className="tw-nav">
        {data.prev ? (
          <a
            className="btn-secondary"
            href={data.prev.href}
            aria-label={data.prev.aria}
            data-week-nav="prev"
            onClick={(e) =>
              onWeekLink(e, { week: data.prev!.week }, data.prev!.href)
            }
          >
            <ChevronIcon dir="up" />
            {labels.prevWeek}
          </a>
        ) : null}
        <p className="tw-range" data-week-range="" data-week={data.week}>
          <time dateTime={data.start}>{data.range}</time>
        </p>
        {data.next ? (
          <a
            className="btn-secondary"
            href={data.next.href}
            aria-label={data.next.aria}
            data-week-nav="next"
            onClick={(e) =>
              onWeekLink(e, { week: data.next!.week }, data.next!.href)
            }
          >
            {labels.nextWeek}
            <ChevronIcon dir="down" />
          </a>
        ) : null}
        <a
          className="btn-secondary"
          href={data.todayHref}
          data-week-nav="today"
          onClick={(e) => onWeekLink(e, {}, data.todayHref)}
        >
          {labels.today}
        </a>
      </nav>
      <form
        method="get"
        action={basePath}
        className="tw-jump"
        aria-label={labels.jumpTo}
        onSubmit={onJump}
      >
        {hiddenFilter.map(([k, v]) => (
          <input key={`${k}=${v}`} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor="tl-at" className="font-bold">
          {labels.jumpTo}
        </label>
        <input
          id="tl-at"
          key={data.week}
          type="date"
          name="at"
          defaultValue={data.start}
          aria-describedby="tl-at-hint"
          className="tw-date"
        />
        <button type="submit" className="btn-primary">
          {labels.jumpGo}
        </button>
        <p id="tl-at-hint" className="tw-hint">
          {labels.jumpHint}
        </p>
      </form>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-timeline-status=""
      >
        {announce}
      </p>

      <div
        key={data.week}
        className="tw-stage"
        data-dir={dir === "none" ? undefined : dir}
        aria-busy={busy || undefined}
      >
        {data.days.length === 0 ? (
          <p className="empty-result" data-timeline-empty="">
            {labels.empty}
          </p>
        ) : (
          <ol className="tw-axis" aria-label={data.range}>
            {data.days.map((day, i) => (
              <WeekDayItem
                key={day.date}
                day={day}
                side={i % 2 === 0 ? "left" : "right"}
                labels={labels}
                dayApiBase={dayApiBase}
                todayBefore={todayIdx === i ? data.todayText : null}
              />
            ))}
            {todayIdx === data.days.length ? (
              <TodayMarker text={data.todayText} />
            ) : null}
          </ol>
        )}
      </div>
      {failed ? (
        <p role="alert" className="tw-hint">
          {labels.loadError}
        </p>
      ) : null}
    </div>
  );
}

function TodayMarker({ text }: { text: string }): ReactElement {
  return (
    <li className="tw-today" data-timeline-today="">
      <span>{text}</span>
    </li>
  );
}

function WeekDayItem({
  day,
  side,
  labels,
  dayApiBase,
  todayBefore,
}: {
  day: WeekDayData;
  side: "left" | "right";
  labels: TimelineWeekLabels;
  dayApiBase: string;
  todayBefore: string | null;
}): ReactElement {
  const titleId = `tw-d-${day.date}`;
  return (
    <>
      {todayBefore ? <TodayMarker text={todayBefore} /> : null}
      <li className="tw-day" data-side={side} data-date={day.date}>
        <h3 className="tw-node" id={titleId}>
          <span aria-hidden="true" className="tw-node-n">
            {day.dayNum}
          </span>
          <span aria-hidden="true" className="tw-node-wd">
            {day.weekday}
          </span>
          <span className="sr-only">{day.title}</span>
        </h3>
        <DayCard day={day} labels={labels} dayApiBase={dayApiBase} />
      </li>
    </>
  );
}

function DayCard({
  day,
  labels,
  dayApiBase,
}: {
  day: WeekDayData;
  labels: TimelineWeekLabels;
  dayApiBase: string;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [engaged, setEngaged] = useState(false);
  const {
    cards,
    card,
    count,
    index,
    dir,
    busy,
    failed,
    announce,
    hydrated,
    multi,
    go,
    onKeyDown,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    swiped,
  } = useDayCards({
    date: day.date,
    apiBase: dayApiBase,
    first: day.first,
    total: day.total,
    currentLabel: labels.dayCurrent,
  });
  const innerTab = !multi || engaged;

  // 追蹤按鈕（accounts 的 portal）的 tabindex 與月曆格同一套規則
  useEffect(() => {
    rootRef.current
      ?.querySelectorAll<HTMLElement>("[data-card-action-game] button")
      .forEach((b) => {
        b.tabIndex = innerTab ? 0 : -1;
      });
  }, [innerTab, index, cards]);

  const prevIndex = ((index - 1 + count) % count) + 1;
  const nextIndex = ((index + 1) % count) + 1;
  const showDots = count <= DAY_DOTS_MAX;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={day.label}
      tabIndex={multi ? 0 : undefined}
      className="tw-card"
      data-timeline-card=""
      data-cal-cell=""
      data-date={day.date}
      data-count={count}
      data-hydrated={hydrated ? "true" : undefined}
      data-index={index}
      data-engaged={innerTab ? "true" : "false"}
      onKeyDown={onKeyDown}
      onFocus={() => setEngaged(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setEngaged(false);
      }}
    >
      <div className="tw-head">
        <span className="tw-count" data-day-count="">
          {fill(labels.releasesCount, { count: day.total })}
        </span>
        {multi ? (
          <span className="tw-switch">
            <button
              type="button"
              className="tw-step"
              aria-label={fill(labels.dayPrev, {
                index: prevIndex,
                total: count,
              })}
              tabIndex={innerTab ? undefined : -1}
              disabled={busy}
              onClick={() => void go(-1)}
              data-cal-nav="prev"
            >
              <ChevronIcon dir="prev" />
            </button>
            <span className="tw-pos" aria-hidden="true" data-cal-pos="">
              {showDots ? (
                <span className="tw-dots">
                  {Array.from({ length: count }, (_, i) => (
                    <span
                      key={i}
                      className="tw-dot"
                      data-on={i === index ? "true" : undefined}
                    />
                  ))}
                </span>
              ) : (
                <span className="tw-poscount">
                  {index + 1} / {count}
                </span>
              )}
            </span>
            <button
              type="button"
              className="tw-step"
              aria-label={fill(labels.dayNext, {
                index: nextIndex,
                total: count,
              })}
              tabIndex={innerTab ? undefined : -1}
              disabled={busy}
              onClick={() => void go(1)}
              data-cal-nav="next"
            >
              <ChevronIcon dir="next" />
            </button>
          </span>
        ) : null}
      </div>

      <div
        className="tw-viewport"
        aria-busy={busy || undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {card ? (
          <a
            key={`${card.id}-${index}`}
            className="tw-link"
            href={card.h}
            data-day-card={card.id}
            data-dir={dir === "none" ? undefined : dir}
            tabIndex={innerTab ? undefined : -1}
            onClick={(e) => {
              if (swiped.current) e.preventDefault();
            }}
          >
            {card.c ? (
              // 封面網址已由 Provider 解析成 CDN 的縮放尺寸（等同 next/image 的 unoptimized），與月曆格相同用原生 img
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="tw-cover"
                src={card.c}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="tw-cover tw-cover-empty" aria-hidden="true" />
            )}
            <span className="tw-info">
              <span className="tw-name" lang={card.nl}>
                {card.n}
              </span>
              {card.pc.length > 0 ? (
                <span className="tw-chips">
                  {card.pc.map((p, i) => (
                    <span key={i} className="cal-chip">
                      {p}
                    </span>
                  ))}
                  {card.pn ? (
                    <span className="cal-chip">+{card.pn}</span>
                  ) : null}
                </span>
              ) : null}
              {card.tg.length > 0 || card.hl ? (
                <span className="tw-tags">
                  {card.hl ? (
                    <span
                      className="cal-heat"
                      role="img"
                      aria-label={card.hl}
                      title={card.hl}
                      data-heat={card.hv}
                    >
                      <span aria-hidden="true">{card.hv}</span>
                    </span>
                  ) : null}
                  {card.tg.map((tag, i) => (
                    <span
                      key={i}
                      className={`cal-tag cal-tag-${tag.k}`}
                      data-tag={tag.k}
                    >
                      {tag.k === "stage" ? (
                        <StageIcon stage={tag.i ?? ""} />
                      ) : tag.k === "status" ? (
                        <StatusIcon status={tag.i ?? ""} />
                      ) : tag.k === "warn" ? (
                        <WarningIcon />
                      ) : null}
                      <span>{tag.l}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </a>
        ) : null}
        {card ? (
          <CardActionHost key={card.id} gameId={card.id} name={card.n} />
        ) : null}
      </div>

      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-cal-live=""
      >
        {announce}
      </span>
      {failed ? (
        <p className="tw-error" role="alert">
          {labels.dayLoadError}{" "}
          <button
            type="button"
            className="cal-retry"
            onClick={() => void go(1)}
          >
            {labels.dayRetry}
          </button>
        </p>
      ) : null}
    </div>
  );
}
