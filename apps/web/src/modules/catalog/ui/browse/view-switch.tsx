"use client";
/**
 * 遊戲列表的卡片大小切換（只看封面／詳細卡片／清單）。三種都是同一份伺服器 markup，只靠 `<html data-gd-view>` 讓 CSS 換版面；
 * 選擇記在 localStorage（每個瀏覽器自己的偏好）。伺服器與首次繪製一律是預設「詳細卡片」，mount 後才套用記住的選擇。
 */
import { useEffect, useSyncExternalStore, type ReactElement } from "react";

const STORAGE_KEY = "gd-view";
const VIEWS = ["cover", "card", "list"] as const;
type View = (typeof VIEWS)[number];

export interface ViewSwitchLabels {
  group: string;
  cover: string;
  card: string;
  list: string;
}

const listeners = new Set<() => void>();
let memory: View | null = null; // localStorage 不能用時（隱私模式）只在這個分頁記住

function readStored(): View {
  if (memory) return memory;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VIEWS.includes(v as View) ? (v as View) : "card";
  } catch {
    return "card";
  }
}
function choose(v: View): void {
  memory = v;
  try {
    window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* 隱私模式：memory 已記住 */
  }
  listeners.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const ICONS: Record<View, ReactElement> = {
  cover: (
    <path d="M1 1h4v4H1V1Zm5 0h4v4H6V1Zm5 0h4v4h-4V1ZM1 6h4v4H1V6Zm5 0h4v4H6V6Zm5 0h4v4h-4V6ZM1 11h4v4H1v-4Zm5 0h4v4H6v-4Zm5 0h4v4h-4v-4Z" />
  ),
  card: <path d="M1 1h6v6H1V1Zm8 0h6v6H9V1ZM1 9h6v6H1V9Zm8 0h6v6H9V9Z" />,
  list: <path d="M1 2h14v3H1V2Zm0 4.5h14v3H1v-3ZM1 11h14v3H1v-3Z" />,
};

export function ViewSwitch({ labels }: { labels: ViewSwitchLabels }): ReactElement {
  const view = useSyncExternalStore(subscribe, readStored, () => "card" as View);

  useEffect(() => {
    document.documentElement.dataset.gdView = view;
    // 封面模式的圖放大到約 150px：改載中圖（cover.medium，伺服器放在 data-m）；離開封面模式不換回，已載入的圖不浪費
    if (view === "cover") {
      document.querySelectorAll<HTMLImageElement>(".bc-item img[data-m]").forEach((img) => {
        const m = img.dataset.m;
        if (m && img.getAttribute("src") !== m) img.setAttribute("src", m);
      });
    }
  }, [view]);

  return (
    <div className="view-switch" role="group" aria-label={labels.group}>
      {VIEWS.map((v) => (
        <button key={v} type="button" className="view-btn" aria-pressed={view === v} aria-label={labels[v]} title={labels[v]} onClick={() => choose(v)}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            {ICONS[v]}
          </svg>
        </button>
      ))}
    </div>
  );
}
