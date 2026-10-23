"use client";
/**
 * 互動背景（client only、延後載入）：把 BackgroundField（canvas 引擎）接上 DOM 事件與彩蛋判定。
 * - canvas 是 `position: fixed; z-index: -1; pointer-events: none`，不蓋住任何內容；
 *   點擊用 window capture 監聽、以 target 判斷是否「直接點在空白背景」（bg-target.ts），是才交給背景。
 * - 彩蛋 1a／1b／1c（依序點破）、3（每日收集物）、4（閒置聚集）、5（蘑菇頭波動拳）在這裡；
 *   2（密技）、6、7、8 在 egg-layer.tsx。
 * - reduced motion：引擎不跑迴圈、不產生粒子；波動拳只給解鎖（不飛）。分頁隱藏時停止迴圈。
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { BackgroundField } from "./background-engine";
import { isBackgroundTarget, nodeInfoFromElement } from "./bg-target";
import { computeFreeMap } from "./free-map";
import {
  DAILY_STORAGE_KEY,
  createHadoukenTracker,
  createIdleTracker,
  createSequenceTracker,
  dailyStateFor,
  localDateKey,
  parseDaily,
} from "./logic";
import { getUnlockStore } from "../unlock-store";
import { UNLOCK_COLLECTIBLE_KEYS, type UnlockCollectibleKey } from "../unlocks";

export const IDLE_GATHER_MS = 60_000;

export interface EggFieldTestApi {
  ready: true;
  symbols(): { kind: string; x: number; y: number; alive: boolean; visible: boolean; ax: number; ay: number; collectible?: boolean }[];
  /** 地圖模式（wide＝內容欄兩側）、目前透明度、符號數。 */
  mode(): { wide: boolean; alpha: number; symbols: number };
  /** 這個座標點下去會不會被判定為空白背景。 */
  isBackgroundAt(x: number, y: number): boolean;
  place(kind: string, x: number, y: number): boolean;
  /** 找一個「直接點下去會被判定為空白背景」的座標（找不到回傳 null）。 */
  findEmptySpot(): { x: number; y: number } | null;
  forceIdle(): void;
  isGathered(): boolean;
  setGatherCenter(x: number, y: number): void;
  frames(): number;
  size(): { w: number; h: number };
  reducedMotion: boolean;
}

declare global {
  interface Window {
    __eggTest?: Record<string, unknown> & { field?: EggFieldTestApi };
  }
}

function readColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();
}

export default function EggBackground(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fly, setFly] = useState<{ id: number; top: number } | null>(null);
  const flyId = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const store = getUnlockStore();
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = reducedQuery.matches;
    const sequences = createSequenceTracker();
    const hadouken = createHadoukenTracker();
    function unlockTarget(type: "theme" | "collectible", key: string): void {
      store.unlock(type, key);
    }

    const field: BackgroundField = new BackgroundField({
      canvas,
      reducedMotion: reduced,
      readColor,
      callbacks: {
        onBreak(kind) {
          for (const s of sequences.hit(kind)) unlockTarget(s.unlock.type as "theme", s.unlock.key);
        },
        onCollect(key: UnlockCollectibleKey) {
          unlockTarget("collectible", key);
          try {
            const d = parseDaily(localStorage.getItem(DAILY_STORAGE_KEY));
            if (d) localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify({ ...d, found: true }));
          } catch {
            // 沒有儲存空間：只影響「今天是否重新出現」
          }
        },
        onStick(dir, now) {
          if (hadouken.push(dir, now)) {
            store.unlock("theme", "arcade-neon");
            if (!reduced) {
              flyId.current += 1;
              setFly({ id: flyId.current, top: 30 + Math.random() * 35 });
            }
          }
        },
        onGatherClick() {
          store.unlock("theme", "standby-purple");
          field.setGather(false);
          idle.activity();
        },
      },
    });

    // ── 每日收集物 ─────────────────────────────────────────
    try {
      const collected = store
        .getSnapshot()
        .filter((r) => r.type === "collectible")
        .map((r) => r.key);
      const state = dailyStateFor(localDateKey(new Date()), parseDaily(localStorage.getItem(DAILY_STORAGE_KEY)), collected);
      if (state) {
        localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
        if (!state.found && (UNLOCK_COLLECTIBLE_KEYS as readonly string[]).includes(state.key)) field.setCollectible(state.key);
      }
    } catch {
      // localStorage 不可用：今天不放收集物
    }

    // ── 尺寸與主題色 ───────────────────────────────────────
    // 可出現區域地圖：內容欄兩側／空白區才放符號；resize、捲動、DOM 變動時節流重算
    let mapTimer: number | undefined;
    let lastMap = 0;
    const refreshMap = (): void => {
      mapTimer = undefined;
      if (document.hidden) return;
      lastMap = performance.now();
      field.setFreeMap(computeFreeMap());
    };
    const scheduleMap = (delay: number): void => {
      if (mapTimer !== undefined) return;
      mapTimer = window.setTimeout(refreshMap, Math.max(delay, 400 - (performance.now() - lastMap)));
    };
    const resize = (): void => {
      field.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
      scheduleMap(150);
    };
    resize();
    refreshMap();
    window.addEventListener("resize", resize);
    const domObserver = new MutationObserver(() => scheduleMap(600));
    domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style"] });
    const mo = new MutationObserver(() => field.refreshColor());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const colorQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = (): void => field.refreshColor();
    colorQuery.addEventListener("change", onScheme);

    // ── 閒置 60 秒 ─────────────────────────────────────────
    const idle = createIdleTracker(IDLE_GATHER_MS, () => field.setGather(true), {
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
    });
    const activity = (scatter: boolean): void => {
      idle.activity();
      if (scatter && field.isGathered) field.setGather(false);
    };

    // ── 指標 ───────────────────────────────────────────────
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const target = e.target instanceof Element ? e.target : null;
      const wasGathered = field.isGathered;
      let consumed = false;
      if (isBackgroundTarget(nodeInfoFromElement(target))) {
        consumed = field.pointerDown(e.clientX, e.clientY, e.pointerId, performance.now());
        if (consumed && field.isDragging && target) {
          hadouken.reset();
          try {
            target.setPointerCapture(e.pointerId);
          } catch {
            // 指標已不在作用中
          }
        }
      }
      if (wasGathered && !consumed) activity(true);
      else idle.activity();
    };
    const onPointerMove = (e: PointerEvent): void => {
      field.pointerMove(e.clientX, e.clientY, performance.now());
      idle.activity();
    };
    const onPointerUp = (e: PointerEvent): void => {
      field.pointerUp(e.pointerId, performance.now());
    };
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t || e.touches.length !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      if (isBackgroundTarget(nodeInfoFromElement(target)) && field.overStick(t.clientX, t.clientY)) e.preventDefault();
    };
    const onSelectStart = (e: Event): void => {
      if (field.isDragging) e.preventDefault();
    };
    const onKey = (): void => activity(true);
    const onWheel = (): void => activity(true);
    const onScroll = (): void => {
      activity(true);
      scheduleMap(200);
    };
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", onPointerDown, opts);
    window.addEventListener("pointermove", onPointerMove, opts);
    window.addEventListener("pointerup", onPointerUp, opts);
    window.addEventListener("pointercancel", onPointerUp, opts);
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    window.addEventListener("keydown", onKey, opts);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("selectstart", onSelectStart);

    // ── 分頁可見性 ─────────────────────────────────────────
    const onVisibility = (): void => {
      if (document.hidden) {
        field.stop();
        idle.stop();
      } else {
        field.start();
        idle.start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) {
      field.start();
      idle.start();
    }

    // ── e2e 測試掛鉤（NEXT_PUBLIC_EGG_TEST 只在 e2e 建置設定；production 不暴露）──
    if (process.env.NEXT_PUBLIC_EGG_TEST === "1") {
      const api: EggFieldTestApi = {
        ready: true,
        reducedMotion: reduced,
        symbols: () => field.snapshot(),
        mode: () => field.mode,
        isBackgroundAt: (x, y) => {
          const el = document.elementFromPoint(x, y);
          return !!el && isBackgroundTarget(nodeInfoFromElement(el));
        },
        place: (kind, x, y) => field.place(kind as Parameters<BackgroundField["place"]>[0], x, y),
        findEmptySpot: () => {
          for (let y = window.innerHeight - 8; y > 8; y -= 24) {
            for (let x = 8; x < window.innerWidth; x += 24) {
              const el = document.elementFromPoint(x, y);
              if (el && isBackgroundTarget(nodeInfoFromElement(el))) return { x, y };
            }
          }
          return null;
        },
        forceIdle: () => field.setGather(true),
        isGathered: () => field.isGathered,
        setGatherCenter: (x, y) => field.setGatherCenter(x, y),
        frames: () => field.frames,
        size: () => ({ w: window.innerWidth, h: window.innerHeight }),
      };
      window.__eggTest = { ...(window.__eggTest ?? {}), field: api };
    }

    return () => {
      field.destroy();
      idle.stop();
      mo.disconnect();
      domObserver.disconnect();
      if (mapTimer !== undefined) window.clearTimeout(mapTimer);
      colorQuery.removeEventListener("change", onScheme);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown, opts);
      window.removeEventListener("pointermove", onPointerMove, opts);
      window.removeEventListener("pointerup", onPointerUp, opts);
      window.removeEventListener("pointercancel", onPointerUp, opts);
      window.removeEventListener("touchstart", onTouchStart, { capture: true });
      window.removeEventListener("keydown", onKey, opts);
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("selectstart", onSelectStart);
      document.removeEventListener("visibilitychange", onVisibility);
      if (window.__eggTest?.field) delete window.__eggTest.field;
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="egg-canvas" aria-hidden="true" data-egg-canvas="" />
      {fly ? <div key={fly.id} className="egg-hadouken" style={{ top: `${fly.top}%` }} aria-hidden="true" onAnimationEnd={() => setFly(null)} /> : null}
    </>
  );
}
