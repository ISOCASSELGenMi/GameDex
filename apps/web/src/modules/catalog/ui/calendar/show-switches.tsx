"use client";
/**
 * 月曆上方的「遊戲／活動」兩個顯示開關（GameDex 第 2 輪）。role="switch"＋aria-checked；狀態在網址 `show` 參數（伺服器決定要不要查活動）。
 * 沒有 JS 時是一般連結（整頁換網址）；有 JS 時額外：
 * - Space 也能切換（switch 的鍵盤慣例；連結原本只有 Enter）。
 * - 點擊時標記這次換頁是「切換開關」，讓跨文件 View Transition 把月曆本體改成 120ms 淡入（globals.css 的 cal-toggle），
 *   而不是換月那種 380ms 浮入（機制見 toggle-transition.ts）；瀏覽器不支援就沒有動畫，功能照常。
 * 最後一個開著的開關不能關（aria-disabled，以 aria-describedby 說明原因）。
 */
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { markToggleNavigation } from "./toggle-transition";

export interface ShowSwitchItem {
  kind: "releases" | "events";
  label: string;
  checked: boolean;
  /** null＝不可切換。 */
  href: string | null;
}

export function ShowSwitches({ items, groupLabel, hint }: { items: ShowSwitchItem[]; groupLabel: string; hint: string }): ReactElement {
  function onClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    markToggleNavigation();
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    if (e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLAnchorElement).click();
    }
  }
  return (
    <div className="cal-show" role="group" aria-label={groupLabel} data-cal-show>
      {items.map((item) => {
        const inner = (
          <>
            <span className="cal-switch-track" aria-hidden="true">
              <span className="cal-switch-thumb" />
            </span>
            <span>{item.label}</span>
          </>
        );
        return item.href ? (
          <a
            key={item.kind}
            role="switch"
            aria-checked={item.checked}
            href={item.href}
            className="cal-switch"
            data-cal-switch={item.kind}
            onClick={onClick}
            onKeyDown={onKeyDown}
          >
            {inner}
          </a>
        ) : (
          <span key={item.kind} role="switch" aria-checked={item.checked} aria-disabled="true" aria-describedby="cal-show-hint" tabIndex={0} title={hint} className="cal-switch" data-cal-switch={item.kind}>
            {inner}
          </span>
        );
      })}
      <p id="cal-show-hint" className="sr-only">
        {hint}
      </p>
    </div>
  );
}
