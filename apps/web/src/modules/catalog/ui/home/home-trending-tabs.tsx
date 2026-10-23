"use client";
/**
 * 首頁「近期熱門」分頁（D86）：即將上市／已上市，兩群資料都由伺服器渲染進 HTML，切換只在 client 顯示／隱藏，不重新請求。
 * WAI-ARIA tabs：role=tablist/tab/tabpanel、aria-selected、roving tabindex、←→ Home End（自動啟用）。
 * 動態（使用頻率低的點擊才有動畫）：
 * - 指示條只用 transform 滑動（200ms、cubic-bezier(0.23, 1, 0.32, 1)）；鍵盤切換不做動畫（duration 0）。
 * - 內容切換用 120ms 的 opacity（WAAPI），鍵盤切換同樣略過。prefers-reduced-motion 只保留 opacity（指示條不滑動）。
 * - 按下 :active 為 scale(0.97)；hover 只在有 hover 能力的精準指標上套用。
 * 沒有 JS 時第二個面板保持 hidden；「查看更多」依目前分頁指向 /trending?group=…，noscript 提供已上市榜單的連結。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

export type TrendingGroup = "upcoming" | "released";
const GROUPS: readonly TrendingGroup[] = ["upcoming", "released"];

export interface HomeTrendingTabsProps {
  title: string;
  tablistLabel: string;
  tabLabels: Record<TrendingGroup, string>;
  /** 每個分頁下方的說明（排序依據＋分群定義）。 */
  hints: Record<TrendingGroup, string>;
  moreHrefs: Record<TrendingGroup, string>;
  moreText: string;
  /** 「查看更多」的可及名稱（已含分頁名稱）。 */
  moreAria: Record<TrendingGroup, string>;
  /** 伺服器渲染好的面板內容。 */
  panels: Record<TrendingGroup, ReactNode>;
}

const TAB_BASE =
  "relative min-h-11 px-5 text-sm font-semibold transition-[color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";

export function HomeTrendingTabs(props: HomeTrendingTabsProps): ReactElement {
  const [active, setActive] = useState<TrendingGroup>("upcoming");
  /** 最近一次切換是否來自鍵盤（鍵盤切換不做動畫）。 */
  const byKeyboard = useRef(false);
  const [instant, setInstant] = useState(false);
  const mounted = useRef(false);
  const tabRefs = useRef<Record<TrendingGroup, HTMLButtonElement | null>>({ upcoming: null, released: null });
  const panelRefs = useRef<Record<TrendingGroup, HTMLDivElement | null>>({ upcoming: null, released: null });

  useEffect(() => {
    // 初次渲染不淡入；之後只有滑鼠／觸控切換才淡入
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (byKeyboard.current) return;
    panelRefs.current[active]?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
  }, [active]);

  function select(group: TrendingGroup, keyboard: boolean): void {
    byKeyboard.current = keyboard;
    setInstant(keyboard);
    setActive(group);
    if (keyboard) tabRefs.current[group]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % GROUPS.length;
    else if (e.key === "ArrowLeft") next = (index + GROUPS.length - 1) % GROUPS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = GROUPS.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(GROUPS[next]!, true);
  }

  const activeIndex = GROUPS.indexOf(active);
  return (
    <section aria-labelledby="home-trending" className="mt-8" data-home-section="trending" data-trending-active={active}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="home-trending" className="text-xl font-bold">
          {props.title}
        </h2>
        <a className="link inline-flex min-h-11 items-center" href={props.moreHrefs[active]} aria-label={props.moreAria[active]} data-home-more="trending">
          {props.moreText}
        </a>
      </div>
      <div role="tablist" aria-label={props.tablistLabel} className="relative mt-2 inline-grid grid-cols-2 border-b border-[var(--border)]">
        {GROUPS.map((group, i) => (
          <button
            key={group}
            ref={(el) => {
              tabRefs.current[group] = el;
            }}
            type="button"
            role="tab"
            id={`home-trending-tab-${group}`}
            aria-selected={active === group}
            aria-controls={`home-trending-panel-${group}`}
            tabIndex={active === group ? 0 : -1}
            data-trending-tab={group}
            className={`${TAB_BASE} ${active === group ? "text-[var(--foreground)]" : "text-[var(--muted)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--foreground)]"}`}
            onClick={() => select(group, false)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {props.tabLabels[group]}
          </button>
        ))}
        <span
          aria-hidden="true"
          data-trending-indicator=""
          className={`pointer-events-none absolute bottom-[-1px] left-0 h-0.5 w-1/2 bg-[var(--link)] transition-transform ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${instant ? "duration-0" : "duration-200"}`}
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
      </div>
      {GROUPS.map((group) => (
        <div
          key={group}
          ref={(el) => {
            panelRefs.current[group] = el;
          }}
          role="tabpanel"
          id={`home-trending-panel-${group}`}
          aria-labelledby={`home-trending-tab-${group}`}
          hidden={active !== group}
          data-trending-panel={group}
        >
          <p className="mt-2 text-sm text-[var(--muted)]">{props.hints[group]}</p>
          {props.panels[group]}
        </div>
      ))}
      <noscript>
        <a className="link inline-flex min-h-11 items-center" href={props.moreHrefs.released}>
          {props.tabLabels.released}
        </a>
      </noscript>
    </section>
  );
}
