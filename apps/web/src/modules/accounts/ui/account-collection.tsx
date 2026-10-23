"use client";
/**
 * 帳號總覽的「收藏與成就」區塊（Z3B；docs/design/easter-eggs.md）：
 * - 遊戲媒體圖鑑 8 格（未收集＝剪影＋「？」，不顯示名稱）、已解鎖主題、已達成成就；
 * - 未解鎖的成就與主題只顯示「還有 N 個」，不顯示名稱與觸發條件；
 * - 全成就時整個區塊有彩虹框線。
 * 資料來自 GET /api/v1/me/unlocks（帳號資料判定的成就已由伺服器補上）。靜態呈現、沒有動畫（reduced-motion 無需處理）。
 */
import { useEffect, useState, type ReactElement } from "react";
import { UNLOCK_ACHIEVEMENT_KEYS, UNLOCK_COLLECTIBLE_KEYS, UNLOCK_THEME_KEYS, type UnlockCollectibleKey, type UnlockRecord } from "@/kernel/ui/unlocks";
import { useAccountSession } from "./account-session";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import { getUnlocks } from "./unlocks-api";

/** 8 種媒體的簡單造型（48×48、單色；剪影與已收集共用同一個形狀）。 */
const MEDIA_SHAPES: Record<UnlockCollectibleKey, ReactElement> = {
  cartridge: (
    <>
      <path d="M10 6h28a2 2 0 0 1 2 2v28l-4 6H12l-4-6V8a2 2 0 0 1 2-2Z" />
      <rect x="14" y="10" width="20" height="14" rx="1" fill="var(--panel)" opacity="0.55" />
    </>
  ),
  floppy: (
    <>
      <path d="M8 6h28l6 6v30H8Z" />
      <rect x="15" y="6" width="16" height="11" fill="var(--panel)" opacity="0.55" />
      <rect x="13" y="26" width="22" height="14" rx="1" fill="var(--panel)" opacity="0.55" />
    </>
  ),
  cd: (
    <>
      <circle cx="24" cy="24" r="19" />
      <circle cx="24" cy="24" r="6" fill="var(--panel)" opacity="0.7" />
    </>
  ),
  dvd: (
    <>
      <circle cx="24" cy="24" r="19" />
      <circle cx="24" cy="24" r="12" fill="none" stroke="var(--panel)" strokeWidth="2" opacity="0.55" />
      <circle cx="24" cy="24" r="5" fill="var(--panel)" opacity="0.7" />
    </>
  ),
  bluray: (
    <>
      <circle cx="24" cy="24" r="19" />
      <path d="M24 5a19 19 0 0 1 16.5 9.5L24 24Z" fill="var(--panel)" opacity="0.45" />
      <circle cx="24" cy="24" r="5" fill="var(--panel)" opacity="0.7" />
    </>
  ),
  "memory-card": (
    <>
      <path d="M12 4h20l8 8v32H12Z" />
      <rect x="17" y="8" width="3" height="8" fill="var(--panel)" opacity="0.55" />
      <rect x="23" y="8" width="3" height="8" fill="var(--panel)" opacity="0.55" />
      <rect x="29" y="8" width="3" height="8" fill="var(--panel)" opacity="0.55" />
    </>
  ),
  "game-card": (
    <>
      <rect x="11" y="4" width="26" height="40" rx="3" />
      <rect x="15" y="9" width="18" height="16" rx="1" fill="var(--panel)" opacity="0.55" />
      <rect x="16" y="35" width="16" height="5" fill="var(--panel)" opacity="0.55" />
    </>
  ),
  cloud: <path d="M14 38a9 9 0 0 1-1-17.9A12 12 0 0 1 36 17a10.5 10.5 0 0 1 1 21Z" />,
};

type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "ready"; records: UnlockRecord[] };

const RAINBOW = "linear-gradient(90deg, #ef4444, #f59e0b, #eab308, #22c55e, #0ea5e9, #6366f1, #d946ef)";

export function AccountCollection({ strings }: { strings: AccountStrings }): ReactElement | null {
  const session = useAccountSession();
  const active = session?.kind === "user" && !session.suspended;
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void getUnlocks().then((res) => {
      if (!alive) return;
      setState(res.ok && res.data && Array.isArray(res.data.unlocks) ? { kind: "ready", records: res.data.unlocks } : { kind: "error" });
    });
    return () => {
      alive = false;
    };
  }, [active]);

  if (!active) return null;

  const keysOf = (type: UnlockRecord["type"]) => new Set(state.kind === "ready" ? state.records.filter((r) => r.type === type).map((r) => r.key) : []);
  const collected = keysOf("collectible");
  const themes = UNLOCK_THEME_KEYS.filter((k) => keysOf("theme").has(k));
  const achievements = UNLOCK_ACHIEVEMENT_KEYS.filter((k) => keysOf("achievement").has(k));
  const allDone = achievements.includes("all-achievements");
  const mediaTotal = UNLOCK_COLLECTIBLE_KEYS.length;
  const themesHidden = UNLOCK_THEME_KEYS.length - themes.length;
  const achievementsHidden = UNLOCK_ACHIEVEMENT_KEYS.length - achievements.length;

  const frameStyle = allDone
    ? { border: "3px solid transparent", background: `linear-gradient(var(--panel), var(--panel)) padding-box, ${RAINBOW} border-box` }
    : { border: "3px solid var(--border)", background: "var(--panel)" };

  return (
    <section aria-labelledby="collection-heading" data-collection={allDone ? "complete" : "partial"} className="flex flex-col gap-4 rounded-[var(--radius-lg)] p-4" style={frameStyle}>
      <h2 id="collection-heading" className="text-xl font-bold">
        {str(strings, "collection.title")}
      </h2>
      {state.kind === "loading" ? <p role="status">{str(strings, "collection.loading")}</p> : null}
      {state.kind === "error" ? <p role="alert" className="notice text-[var(--danger)]">{str(strings, "collection.error")}</p> : null}
      {state.kind === "ready" ? (
        <>
          {allDone ? (
            <p data-collection-all className="font-bold">
              {str(strings, "collection.allDone")}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <h3 id="collection-media-heading" className="font-bold">
              {str(strings, "collection.mediaTitle")}
            </h3>
            <p className="text-sm text-[var(--muted)]">{str(strings, "collection.mediaCount", { n: String(collected.size), total: String(mediaTotal) })}</p>
            <ul aria-labelledby="collection-media-heading" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {UNLOCK_COLLECTIBLE_KEYS.map((key) => {
                const has = collected.has(key);
                return (
                  <li key={key} data-collectible={key} data-collected={has ? "true" : "false"} className="flex flex-col items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center">
                    <span className="relative flex size-14 items-center justify-center">
                      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" fill="currentColor" className={has ? "text-[var(--link)]" : "text-[var(--border)]"}>
                        {MEDIA_SHAPES[key]}
                      </svg>
                      {has ? null : (
                        <span aria-hidden="true" className="absolute text-xl font-bold text-[var(--muted)]">
                          ?
                        </span>
                      )}
                    </span>
                    <span className="text-sm">{has ? str(strings, `collection.media.${key}`) : <span className="text-[var(--muted)]">{str(strings, "collection.notCollected")}</span>}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 id="collection-themes-heading" className="font-bold">
              {str(strings, "collection.themesTitle")}
            </h3>
            {themes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{str(strings, "collection.themesNone")}</p>
            ) : (
              <ul aria-labelledby="collection-themes-heading" className="flex flex-wrap gap-2">
                {themes.map((key) => (
                  <li key={key} data-theme-unlocked={key} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm">
                    {str(strings, `collection.theme.${key}`)}
                  </li>
                ))}
              </ul>
            )}
            {themesHidden > 0 ? (
              <p className="text-sm text-[var(--muted)]" data-themes-hidden={themesHidden}>
                {str(strings, "collection.themesHidden", { n: String(themesHidden) })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 id="collection-achievements-heading" className="font-bold">
              {str(strings, "collection.achievementsTitle")}
            </h3>
            {achievements.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{str(strings, "collection.achievementsNone")}</p>
            ) : (
              <ul aria-labelledby="collection-achievements-heading" className="flex flex-wrap gap-2">
                {achievements.map((key) => (
                  <li key={key} data-achievement-unlocked={key} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm">
                    {str(strings, `collection.achievement.${key}`)}
                  </li>
                ))}
              </ul>
            )}
            {achievementsHidden > 0 ? (
              <p className="text-sm text-[var(--muted)]" data-achievements-hidden={achievementsHidden}>
                {str(strings, "collection.achievementsHidden", { n: String(achievementsHidden) })}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
