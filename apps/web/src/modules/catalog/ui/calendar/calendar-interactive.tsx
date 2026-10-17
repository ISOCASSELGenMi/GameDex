"use client";
/**
 * 月曆的漸進增強（沒有 JS 時月曆照常可用：格內是第一款的詳情頁連結、未定日是一般連結）。
 * 有 JS 時：
 * - 點封面（格內的 DayCell，或「本月未定日」的卡片）→ 側邊預覽卡（<dialog> showModal：焦點移入、Esc 關閉、關閉後回到觸發點）
 * - 在月曆格內按 PageUp／PageDown 換月
 * 格內切換（左右鍵、按鈕、滑動）與「今天」標示由 DayCell 自己處理。
 */
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { HeatBadge } from "../heat-badge";
import { StageIcon, StatusIcon, WarningIcon } from "../icons";
import { CalendarCellConfigContext, CalendarSheetContext, type CalendarCellConfig, type CalendarSheetApi } from "./sheet-context";
import type { CalendarClientLabels, PreviewCardData } from "./types";

function isModified(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export function CalendarInteractive({
  previews,
  labels,
  cell,
  children,
}: {
  /** 「本月未定日」卡片（key → 預覽資料）；格內卡片的資料自帶。 */
  previews: Record<string, PreviewCardData>;
  labels: CalendarClientLabels;
  /** 月曆格共用的 day API 網址與文字。 */
  cell: CalendarCellConfig;
  children: ReactNode;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [card, setCard] = useState<PreviewCardData | null>(null);

  const openCard = useCallback((data: PreviewCardData, trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setCard(data);
  }, []);
  const api = useMemo<CalendarSheetApi>(() => ({ openCard }), [openCard]);

  // 開啟時：showModal 並把焦點移到標題
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!card) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
  }, [card]);

  const close = useCallback(() => setCard(null), []);

  // 原生 Esc 會直接關閉 dialog：同步狀態；焦點瀏覽器通常已還給觸發點，這裡只在焦點掉到 body 時補一次（不搶走使用者已移走的焦點）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      // 原生 close 事件是非同步的：若在它送達前使用者已開了另一張預覽卡（dialog 又是 open），不要把新的卡片清掉
      if (dialog.open) return;
      setCard(null);
      const trigger = triggerRef.current;
      triggerRef.current = null;
      const active = document.activeElement;
      if (trigger && trigger.isConnected && (!active || active === document.body)) trigger.focus();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  // 未定日清單的連結（以 key 對應預覽資料）
  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || isModified(e)) return;
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-card]");
      if (link && link.dataset.card && previews[link.dataset.card]) {
        e.preventDefault();
        openCard(previews[link.dataset.card]!, link);
      }
    },
    [openCard, previews],
  );

  // PageUp／PageDown：換月（焦點在月曆格內時）
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "PageUp" && e.key !== "PageDown") return;
    if (!(e.target as HTMLElement).closest("[data-calendar-grid]")) return;
    const link = rootRef.current?.ownerDocument.querySelector<HTMLAnchorElement>(`a[data-month-nav="${e.key === "PageUp" ? "prev" : "next"}"]`);
    if (link) {
      e.preventDefault();
      link.click();
    }
  }, []);

  return (
    <CalendarSheetContext.Provider value={api}>
      <CalendarCellConfigContext.Provider value={cell}>
      <div ref={rootRef} onClick={onClick} onKeyDown={onKeyDown}>
        {children}
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
            <div className="flex items-start justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={close}>
                {labels.close}
              </button>
            </div>

            {card ? (
              <article className="mt-2">
                <h2 id="sheet-title" ref={titleRef} tabIndex={-1} className="text-xl font-semibold outline-none">
                  {card.n}
                </h2>
                {card.hl ? (
                  <p className="mt-2">
                    <HeatBadge level={card.hv} label={card.hl} />
                  </p>
                ) : null}
                {card.c ? <Image className="sheet-cover" src={card.c} alt={card.n} width={264} height={352} unoptimized /> : null}
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
      </CalendarCellConfigContext.Provider>
    </CalendarSheetContext.Provider>
  );
}
