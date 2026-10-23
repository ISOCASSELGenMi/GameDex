"use client";
/**
 * 彩蛋層（掛在 [locale] 版面，client only）：解鎖提示、鍵盤密技、凌晨造訪、品牌連點、瀏覽器端成就、
 * 解鎖紀錄與帳號同步、延後啟動互動背景（程式碼分割，idle 或首次互動後才載入）。
 * 伺服器 HTML 只有一個空的 aria-live 容器（不含使用者狀態、可快取）。
 *
 * 連點品牌（彩蛋 8）：只在首頁算（2 秒內 10 次）。首頁上品牌連結指向自己，點擊一律 preventDefault（不重新載入）；
 * 其他頁點品牌照常立即前往首頁（不延遲、不計數）。
 */
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { UNLOCK_ACHIEVEMENT_KEYS, registerUnlockSync, type UnlockRecord, type UnlockSync } from "../unlocks";
import { getUnlockStore } from "../unlock-store";
import {
  VIEWED_GOAL,
  VIEWED_STORAGE_KEY,
  createClickCounter,
  createKonamiTracker,
  gameSlugFromPath,
  hasAllCollectibles,
  isNightOwlHour,
  isTypingTarget,
  othersAchieved,
  parseViewed,
  recordViewedGame,
} from "./logic";
import { UnlockToasts, type EggLabels } from "./unlock-toasts";

const EggBackground = dynamic(() => import("./background"), { ssr: false });

export type { EggLabels };

const BRAND_CLICKS = 10;
const BRAND_WINDOW_MS = 2000;

export function EggLayer({ labels }: { labels: EggLabels }): ReactElement {
  const pathname = usePathname();
  const [bgOn, setBgOn] = useState(false);

  // ── 紀錄、衍生解鎖、同步、夜貓子、測試掛鉤 ─────────────────
  useEffect(() => {
    const store = getUnlockStore();
    store.reload();
    const derive = (): void => {
      // 衍生解鎖會再觸發 subscribe（巢狀 derive），所以屬性要在解鎖之後用最新紀錄判斷
      if (hasAllCollectibles(store.getSnapshot())) store.unlock("theme", "gold");
      if (othersAchieved(store.getSnapshot())) store.unlock("achievement", "all-achievements");
      const root = document.documentElement;
      if (store.getSnapshot().some((r: UnlockRecord) => r.type === "achievement" && r.key === "all-achievements")) root.setAttribute("data-all-achievements", "true");
      else root.removeAttribute("data-all-achievements");
    };
    derive();
    const off = store.subscribe(derive);
    void store.syncNow();
    if (isNightOwlHour(new Date())) store.unlock("theme", "night-owl");
    if (process.env.NEXT_PUBLIC_EGG_TEST === "1") {
      window.__eggTest = {
        ...(window.__eggTest ?? {}),
        records: () => store.getSnapshot(),
        unlock: (type: "theme" | "collectible" | "achievement", key: string) => store.unlock(type, key),
        achievementKeys: UNLOCK_ACHIEVEMENT_KEYS,
        registerSync: (impl: UnlockSync | null) => registerUnlockSync(impl),
      };
    }
    return off;
  }, []);

  // ── 延後啟動背景 ──────────────────────────────────────────
  useEffect(() => {
    let done = false;
    const start = (): void => {
      if (done) return;
      done = true;
      setBgOn(true);
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = ric ? ric(start, { timeout: 2500 }) : window.setTimeout(start, 1500);
    const first = { capture: true, once: true, passive: true } as const;
    window.addEventListener("pointerdown", start, first);
    window.addEventListener("keydown", start, first);
    return () => {
      done = true;
      if (!ric) window.clearTimeout(handle);
      else (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("keydown", start, true);
    };
  }, []);

  // ── 彩蛋 2：科納米密技（輸入元件有焦點時不偵測；輸入過程不做任何回饋）──
  useEffect(() => {
    const store = getUnlockStore();
    const konami = createKonamiTracker();
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement as HTMLElement | null) || isTypingTarget(e.target as HTMLElement | null)) {
        konami.reset();
        return;
      }
      if (konami.key(e.code)) store.unlock("theme", "eight-bit");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 彩蛋 8 與成就：品牌連點、訂閱頁按鈕 ─────────────────────
  useEffect(() => {
    const store = getUnlockStore();
    const counter = createClickCounter(BRAND_CLICKS, BRAND_WINDOW_MS);
    const onClick = (e: MouseEvent): void => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const brand = el.closest<HTMLAnchorElement>("a[data-site-brand]");
      if (brand) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
        // 只在首頁（品牌連結指向目前頁）計數並攔截；其他頁照常立即前往首頁，不延遲、不計數
        const url = new URL(brand.href, window.location.href);
        const trim = (p: string): string => p.replace(/\/+$/, "");
        if (trim(url.pathname) !== trim(window.location.pathname)) {
          counter.reset();
          return;
        }
        e.preventDefault();
        if (counter.click(Date.now())) store.unlock("theme", "coding");
        return;
      }
      if (el.closest('[data-feed] [data-action="open"], [data-feed] [data-action="copy"]')) store.unlock("achievement", "first-ical-subscribe");
    };
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  // ── 成就：看過 50 款遊戲詳情（同一款只算一次）─────────────────
  useEffect(() => {
    const slug = gameSlugFromPath(pathname);
    if (!slug) return;
    try {
      const { list, reached } = recordViewedGame(parseViewed(localStorage.getItem(VIEWED_STORAGE_KEY)), slug, VIEWED_GOAL);
      localStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(list));
      if (reached) getUnlockStore().unlock("achievement", "viewed-50-games");
    } catch {
      // 無法儲存就不計
    }
  }, [pathname]);

  return (
    <>
      <UnlockToasts labels={labels} />
      {bgOn ? <EggBackground /> : null}
    </>
  );
}
