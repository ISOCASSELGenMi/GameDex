"use client";
/**
 * 月曆的漸進增強（沒有 JS 時月曆照常可用：卡片是詳情頁連結、「＋N」是 <details>）。
 * 有 JS 時：
 * - ARIA grid 鍵盤操作：方向鍵在日期格間移動（roving tabindex）、Home／End（列首尾）、Ctrl+Home／End（月首尾）、
 *   PageUp／PageDown 換月、Enter／空白鍵開啟當天完整清單
 * - 點卡片 → 側邊預覽卡（<dialog> showModal：焦點移入、Esc 關閉、關閉後回到觸發點）
 * - 點「＋N」→ 預覽面板顯示當天完整清單
 * - 以使用者裝置時區標示「今天」（伺服器輸出不含今天，頁面可被共用快取）
 */
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { igdbImageUrl } from "../../domain/entities/cover-image";
import { EventIcon, StageIcon, StatusIcon, WarningIcon } from "../icons";
import { PreviewDataContext } from "./folded-cards";
import type { CalendarClientLabels, PreviewCardData } from "./types";

interface DayEntry {
  kind: "card" | "event";
  key: string;
  text: string;
  sub: string;
}

type View =
  | { mode: "closed" }
  | { mode: "day"; date: string; dateLabel: string; entries: DayEntry[] }
  | { mode: "card"; key: string; fromDay?: { date: string; dateLabel: string; entries: DayEntry[] } };

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function localTodayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function isModified(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export function CalendarInteractive({
  previews,
  labels,
  children,
}: {
  previews: Record<string, PreviewCardData>;
  labels: CalendarClientLabels;
  children: ReactNode;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const returnKeyRef = useRef<string | null>(null);
  const [view, setView] = useState<View>({ mode: "closed" });

  const grid = useCallback(() => rootRef.current?.querySelector<HTMLTableElement>("[data-calendar-grid]") ?? null, []);
  const cellOf = useCallback(
    (iso: string) => grid()?.querySelector<HTMLTableCellElement>(`td[data-date="${iso}"]`) ?? null,
    [grid],
  );

  // roving tabindex 與「今天」
  useEffect(() => {
    const root = rootRef.current;
    const table = grid();
    if (!root) return;
    const today = localTodayIso();
    root.querySelectorAll<HTMLElement>(`[data-date="${today}"], [data-agenda-day="${today}"]`).forEach((el) => {
      el.classList.add("is-today");
      el.setAttribute("aria-current", "date");
    });
    if (!table) return;
    const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-date]"));
    for (const cell of cells) {
      cell.tabIndex = -1;
      cell.querySelectorAll<HTMLElement>("a, summary").forEach((el) => {
        el.tabIndex = -1;
      });
    }
    const start = cells.find((c) => c.dataset.date === today) ?? cells[0];
    if (start) start.tabIndex = 0;
  }, [grid]);

  const focusCell = useCallback(
    (iso: string) => {
      const target = cellOf(iso);
      if (!target) return false;
      grid()
        ?.querySelectorAll<HTMLTableCellElement>('td[data-date][tabindex="0"]')
        .forEach((c) => {
          c.tabIndex = -1;
        });
      target.tabIndex = 0;
      target.focus();
      return true;
    },
    [cellOf, grid],
  );

  const readDay = useCallback(
    (iso: string): { date: string; dateLabel: string; entries: DayEntry[] } => {
      const cell = cellOf(iso) ?? rootRef.current?.querySelector<HTMLElement>(`[data-agenda-day="${iso}"]`) ?? null;
      const entries: DayEntry[] = [];
      cell?.querySelectorAll<HTMLElement>("[data-card], [data-event]").forEach((el) => {
        const key = el.dataset.card ?? el.dataset.event ?? "";
        if (el.dataset.card !== undefined) {
          const p = previews[key];
          if (p) entries.push({ kind: "card", key, text: p.n, sub: [p.p, p.s, p.t].filter(Boolean).join(" · ") });
        } else {
          const name = el.querySelector(".ev-name")?.textContent ?? "";
          const sub = el.querySelector(".fc-p")?.textContent ?? "";
          entries.push({ kind: "event", key, text: name, sub });
        }
      });
      const dateLabel = cell?.dataset.dayLabel ?? iso;
      return { date: iso, dateLabel, entries };
    },
    [cellOf, previews],
  );

  const open = useCallback((next: View, trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setView(next);
  }, []);

  // 開啟／切換時：showModal 並把焦點移到標題
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (view.mode === "closed") {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    if (returnKeyRef.current && view.mode === "day") {
      const btn = dialog.querySelector<HTMLElement>(`[data-entry="${returnKeyRef.current}"]`);
      returnKeyRef.current = null;
      if (btn) {
        btn.focus();
        return;
      }
    }
    titleRef.current?.focus();
  }, [view]);

  const close = useCallback(() => setView({ mode: "closed" }), []);

  // 原生 Esc 會直接關閉 dialog：同步狀態並把焦點還給觸發點
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setView({ mode: "closed" });
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger && trigger.isConnected) trigger.focus();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || isModified(e)) return;
      const target = e.target as HTMLElement;
      const more = target.closest<HTMLElement>("summary[data-day-more]");
      if (more) {
        const iso = more.closest<HTMLElement>("td[data-date]")?.dataset.date;
        if (iso) {
          e.preventDefault();
          const day = readDay(iso);
          open({ mode: "day", ...day }, more);
        }
        return;
      }
      const card = target.closest<HTMLAnchorElement>("a[data-card]");
      if (card && card.dataset.card && previews[card.dataset.card]) {
        e.preventDefault();
        open({ mode: "card", key: card.dataset.card }, card);
      }
    },
    [open, previews, readDay],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const cell = (e.target as HTMLElement).closest<HTMLTableCellElement>("td[data-date]");
      if (!cell || e.target !== cell) return;
      const iso = cell.dataset.date!;
      const weekday = cell.cellIndex;
      let next: string | null = null;
      switch (e.key) {
        case "ArrowRight":
          next = addDays(iso, 1);
          break;
        case "ArrowLeft":
          next = addDays(iso, -1);
          break;
        case "ArrowDown":
          next = addDays(iso, 7);
          break;
        case "ArrowUp":
          next = addDays(iso, -7);
          break;
        case "Home": {
          if (e.ctrlKey) {
            next = `${iso.slice(0, 8)}01`;
          } else {
            // 本列第一個本月日期
            for (let i = weekday; i >= 0; i--) if (cellOf(addDays(iso, -i))) { next = addDays(iso, -i); break; }
          }
          break;
        }
        case "End": {
          if (e.ctrlKey) {
            const cells = grid()?.querySelectorAll<HTMLTableCellElement>("td[data-date]");
            next = cells && cells.length > 0 ? cells[cells.length - 1]!.dataset.date! : null;
          } else {
            for (let i = 6 - weekday; i >= 0; i--) if (cellOf(addDays(iso, i))) { next = addDays(iso, i); break; }
          }
          break;
        }
        case "PageUp":
        case "PageDown": {
          const link = rootRef.current?.ownerDocument.querySelector<HTMLAnchorElement>(
            `a[data-month-nav="${e.key === "PageUp" ? "prev" : "next"}"]`,
          );
          if (link) {
            e.preventDefault();
            link.click();
          }
          return;
        }
        case "Enter":
        case " ": {
          e.preventDefault();
          open({ mode: "day", ...readDay(iso) }, cell);
          return;
        }
        default:
          return;
      }
      e.preventDefault();
      if (next) focusCell(next);
    },
    [cellOf, focusCell, grid, open, readDay],
  );

  const card = view.mode === "card" ? previews[view.key] : undefined;

  return (
    <div ref={rootRef} onClick={onClick} onKeyDown={onKeyDown}>
      <PreviewDataContext.Provider value={previews}>{children}</PreviewDataContext.Provider>
      <dialog
        ref={dialogRef}
        className="side-sheet"
        aria-labelledby="sheet-title"
        onClick={(e) => {
          // 點背景（dialog 本身）關閉
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="side-sheet-inner">
          <div className="flex items-start justify-between gap-2">
            {view.mode === "card" && view.fromDay ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  returnKeyRef.current = view.key;
                  setView({ mode: "day", ...view.fromDay! });
                }}
              >
                <span aria-hidden="true">{"← "}</span>
                {labels.backToList}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="btn-secondary" onClick={close}>
              {labels.close}
            </button>
          </div>

          {view.mode === "day" ? (
            <>
              <h2 id="sheet-title" ref={titleRef} tabIndex={-1} className="mt-2 text-lg font-semibold outline-none">
                {labels.dayDialogTitle.replace("{date}", view.dateLabel)}
              </h2>
              <ul className="mt-3 flex flex-col gap-1">
                {view.entries.map((entry) => (
                  <li key={entry.key}>
                    {entry.kind === "card" ? (
                      <button
                        type="button"
                        className="sheet-entry"
                        data-entry={entry.key}
                        onClick={() => setView({ mode: "card", key: entry.key, fromDay: { date: view.date, dateLabel: view.dateLabel, entries: view.entries } })}
                      >
                        <span className="font-medium">{entry.text}</span>
                        <span className="block text-sm text-[var(--muted)]">{entry.sub}</span>
                      </button>
                    ) : (
                      <div className="sheet-entry">
                        <span className="ev-tag">
                          <EventIcon />
                          <span>{labels.event}</span>
                        </span>{" "}
                        <span className="font-medium" lang="en">
                          {entry.text}
                        </span>
                        <span className="block text-sm text-[var(--muted)]">{entry.sub}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {view.mode === "card" && card ? (
            <article className="mt-2">
              <h2 id="sheet-title" ref={titleRef} tabIndex={-1} className="text-xl font-semibold outline-none">
                {card.n}
              </h2>
              {card.c ? (
                <Image
                  className="mt-3 h-auto w-40 rounded-md"
                  src={igdbImageUrl(card.c, "t_cover_big")}
                  alt={card.n}
                  width={264}
                  height={352}
                  unoptimized
                />
              ) : null}
              <dl className="sheet-dl">
                {card.o ? (
                  <>
                    <dt>{labels.originalName}</dt>
                    <dd>{card.o}</dd>
                  </>
                ) : null}
                <dt>{labels.platforms}</dt>
                <dd>{card.p || "—"}</dd>
                <dt>{labels.date}</dt>
                <dd>{card.d}</dd>
                <dt>{labels.stage}</dt>
                <dd>
                  <StageIcon stage={card.sk} /> {card.s}
                </dd>
                {card.t ? (
                  <>
                    <dt>{labels.status}</dt>
                    <dd>
                      <StatusIcon status={card.tk ?? ""} /> {card.t}
                    </dd>
                  </>
                ) : null}
              </dl>
              {card.r ? (
                <p className="card-warn mt-2">
                  <WarningIcon /> {labels.sourceUnconfirmed}
                </p>
              ) : null}
              {/* UI slot：game.actions（追蹤／收藏、建立 Discord 活動；02）。3a 沒有提供者，不放任何按鈕。 */}
              <p className="mt-4">
                <a className="btn-primary" href={card.h}>
                  {labels.viewGame}
                </a>
              </p>
            </article>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
