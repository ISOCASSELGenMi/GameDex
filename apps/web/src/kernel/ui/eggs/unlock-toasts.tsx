"use client";
/**
 * 解鎖提示：右下角（窄螢幕貼底）從畫面右緣滑入、同方向滑出。
 * - 容器永遠存在且 aria-live="polite"；新提示加進去時螢幕閱讀器會讀出。
 * - 幾秒後自動消失；滑鼠移上去或焦點在裡面時暫停計時；Esc（焦點在提示內）或「關閉」按鈕立即關閉。
 * - 主題類解鎖多一顆「立即套用」。
 * - 動畫：進場 ease-out 220ms、出場 140ms（見 eggs.css）；reduced-motion 只做淡入淡出。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { selectTheme } from "../theme-controller";
import { getUnlockStore } from "../unlock-store";
import type { UnlockRecord } from "../unlocks";

export interface EggLabels {
  unlockedTheme: string;
  unlockedCollectible: string;
  unlockedAchievement: string;
  apply: string;
  close: string;
  themes: Record<string, string>;
  collectibles: Record<string, string>;
  achievements: Record<string, string>;
}

const SHOW_MS = 6500;
const MAX_TOASTS = 3;

interface ToastItem {
  id: number;
  record: UnlockRecord;
}

function nameOf(labels: EggLabels, r: UnlockRecord): string {
  const table = r.type === "theme" ? labels.themes : r.type === "collectible" ? labels.collectibles : labels.achievements;
  return table[r.key] ?? r.key;
}

export function UnlockToasts({ labels }: { labels: EggLabels }): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const store = getUnlockStore();
    return store.onUnlock((record) => {
      setItems((cur) => [...cur, { id: nextId.current++, record }].slice(-MAX_TOASTS));
    });
  }, []);

  const remove = useCallback((id: number) => setItems((cur) => cur.filter((i) => i.id !== id)), []);

  return (
    <div className="egg-toasts" aria-live="polite" aria-atomic="false" data-egg-toasts="">
      {items.map((item) => (
        <Toast key={item.id} item={item} labels={labels} onDone={remove} />
      ))}
    </div>
  );
}

function Toast({ item, labels, onDone }: { item: ToastItem; labels: EggLabels; onDone: (id: number) => void }): ReactElement {
  const [phase, setPhase] = useState<"enter" | "in" | "out">("enter");
  const remaining = useRef(SHOW_MS);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  const closing = useRef(false);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    clearTimeout(timer.current);
    setPhase("out");
    setTimeout(() => onDone(item.id), 160);
  }, [item.id, onDone]);

  const arm = useCallback(() => {
    clearTimeout(timer.current);
    startedAt.current = Date.now();
    timer.current = setTimeout(dismiss, remaining.current);
  }, [dismiss]);

  const pause = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(1200, remaining.current - (Date.now() - startedAt.current));
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("in")));
    arm();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer.current);
    };
  }, [arm]);

  const maybeResume = (): void => {
    if (!hovered.current && !focused.current && !closing.current) arm();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  };
  const r = item.record;
  const kind = r.type === "theme" ? labels.unlockedTheme : r.type === "collectible" ? labels.unlockedCollectible : labels.unlockedAchievement;

  return (
    <div
      className="egg-toast"
      data-state={phase}
      data-unlock-type={r.type}
      data-unlock-key={r.key}
      onKeyDown={onKeyDown}
      onMouseEnter={() => {
        hovered.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        maybeResume();
      }}
      onFocus={() => {
        focused.current = true;
        pause();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focused.current = false;
        maybeResume();
      }}
    >
      <p className="egg-toast-text">
        <span className="egg-toast-kind">{kind}</span>
        <strong>{nameOf(labels, r)}</strong>
      </p>
      <div className="egg-toast-actions">
        {r.type === "theme" ? (
          <button
            type="button"
            className="btn-primary egg-toast-btn"
            data-egg-apply=""
            onClick={() => {
              selectTheme(r.key);
              dismiss();
            }}
          >
            {labels.apply}
          </button>
        ) : null}
        <button type="button" className="btn-secondary egg-toast-btn" data-egg-close="" onClick={dismiss}>
          {labels.close}
        </button>
      </div>
    </div>
  );
}
