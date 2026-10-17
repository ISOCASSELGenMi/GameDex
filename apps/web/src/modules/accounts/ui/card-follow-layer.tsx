"use client";
/**
 * 月曆與時間軸卡片的追蹤按鈕（slot `card.actions`；D83）。整頁只掛載這一個元件。
 * - 卡片旁有 catalog 放的空掛載點（`[data-card-action-game]`，見 catalog/ui/card-action-host.tsx）；伺服器 HTML 永遠是空的，與使用者無關。
 * - 掛載後取 session：已登入才一次批次查詢畫面上所有遊戲的追蹤狀態（`me/follows/state`，每批最多 FOLLOW_STATE_TARGETS_MAX 個，
 *   重複的遊戲只查一次；時間軸載入更多時只查新出現的），不是每張卡片各打一次 API。未登入也顯示按鈕，按下導到登入頁。
 * - 按鈕用 portal 放進掛載點；同一款遊戲出現在多處（月曆格＋議程）共用同一個狀態。
 * - 月曆格（role=group，款數 > 1 時是 Tab 停駐點）內的按鈕：Tab 進格之前不進 Tab 順序（格上 data-engaged="false"），Tab 進格後才進（DayCell 同步維護）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { FOLLOW_STATE_TARGETS_MAX } from "../domain/entities/follows";
import { followTarget, getFollowState, unfollowTarget } from "./follow-api";
import { useSessionState } from "./follow-button";
import { accountPageHref, safeNextPath } from "./links";
import { apiErrorText } from "./play-record-form";
import { str } from "./str";
import type { AccountStrings } from "./strings";

const HOST_SELECTOR = "[data-card-action-game]";

interface Host {
  el: HTMLElement;
  /** portal 的 key（掛載點元素存活期間不變）。 */
  key: number;
  gameId: number;
  name: string;
}

const hostKeys = new WeakMap<HTMLElement, number>();
let hostKeySeq = 0;

function readHosts(): Host[] {
  const out: Host[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(HOST_SELECTOR)) {
    const gameId = Number(el.getAttribute("data-card-action-game"));
    if (!Number.isSafeInteger(gameId) || gameId <= 0) continue;
    let key = hostKeys.get(el);
    if (key === undefined) {
      key = hostKeySeq++;
      hostKeys.set(el, key);
    }
    out.push({ el, key, gameId, name: el.getAttribute("data-card-action-name") ?? "" });
  }
  return out;
}

const sameHosts = (a: readonly Host[], b: readonly Host[]) => a.length === b.length && a.every((h, i) => h.el === b[i]!.el);

function PlusIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
function CheckIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 8.5 3.2 3.2L13 4.8" />
    </svg>
  );
}

export function CardFollowLayer({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const session = useSessionState();
  const [hosts, setHosts] = useState<Host[]>([]);
  // gameId → 追蹤中？（沒有 key ＝尚未查到）
  const [following, setFollowing] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [announce, setAnnounce] = useState("");
  const requested = useRef(new Set<number>());

  // 掃描掛載點（掛載後一次；時間軸「載入更多」、換月份造成 DOM 變動時再掃，合併成每個影格最多一次）
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      const next = readHosts();
      setHosts((cur) => (sameHosts(cur, next) ? cur : next));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(scan);
    };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  // 已登入：批次查詢還沒查過的遊戲
  useEffect(() => {
    if (session !== "user") return;
    const ids = [...new Set(hosts.map((h) => h.gameId))].filter((id) => !requested.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) requested.current.add(id);
    void (async () => {
      for (let i = 0; i < ids.length; i += FOLLOW_STATE_TARGETS_MAX) {
        const chunk = ids.slice(i, i + FOLLOW_STATE_TARGETS_MAX);
        const res = await getFollowState(chunk.map((targetId) => ({ targetType: "game" as const, targetId })));
        if (!res.ok || !res.data) {
          for (const id of chunk) requested.current.delete(id); // 失敗：下次掃描再試
          continue;
        }
        const items = res.data.items;
        setFollowing((cur) => {
          const next = new Map(cur);
          for (const id of chunk) next.set(id, items.find((x) => x.targetType === "game" && x.targetId === id)?.following ?? false);
          return next;
        });
      }
    })();
  }, [hosts, session]);

  // 月曆格內的按鈕不進 Tab 順序（與格內連結一致）；其他位置恢復預設
  useEffect(() => {
    for (const h of hosts) {
      const b = h.el.querySelector("button");
      if (b) b.tabIndex = h.el.closest('[data-cal-cell][data-engaged="false"]') ? -1 : 0; // 進格狀態會變，所以現場判斷
    }
  });

  const toggle = useCallback(
    async (gameId: number, name: string): Promise<void> => {
      if (session === "anonymous") {
        const here = safeNextPath(`${window.location.pathname}${window.location.search}`, `/${locale}/calendar`);
        window.location.assign(accountPageHref(locale, "login", `next=${encodeURIComponent(here)}`));
        return;
      }
      if (session !== "user" || busy.has(gameId)) return;
      const next = !(following.get(gameId) ?? false);
      setBusy((cur) => new Set(cur).add(gameId));
      setFollowing((cur) => new Map(cur).set(gameId, next)); // 樂觀更新
      const res = next ? await followTarget("game", gameId) : await unfollowTarget("game", gameId);
      setBusy((cur) => {
        const s = new Set(cur);
        s.delete(gameId);
        return s;
      });
      if (res.ok) {
        setAnnounce(str(strings, next ? "follow.cardOn" : "follow.cardOff", { name }));
        return;
      }
      setFollowing((cur) => new Map(cur).set(gameId, !next)); // 失敗：還原
      setAnnounce(res.status === 401 ? str(strings, "error.unauthorized") : apiErrorText(strings, res));
    },
    [busy, following, locale, session, strings],
  );

  const portals = useMemo(() => (session === "loading" ? [] : hosts), [hosts, session]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-card-follow-status="">
        {announce}
      </p>
      {portals.map((h) => {
        const state = following.get(h.gameId);
        const pressed = state === true;
        return createPortal(
          <button
            type="button"
            className={`${pressed ? "btn-primary" : "btn-secondary"} card-follow`}
            aria-pressed={pressed}
            aria-label={str(strings, "follow.cardAria", { name: h.name })}
            disabled={busy.has(h.gameId) || (session === "user" && state === undefined)}
            data-card-follow={session === "user" ? (state === undefined ? "loading" : pressed ? "on" : "off") : session}
            onClick={() => void toggle(h.gameId, h.name)}
          >
            {pressed ? <CheckIcon /> : <PlusIcon />}
            <span>{str(strings, "follow.button")}</span>
          </button>,
          h.el,
          String(h.key),
        );
      })}
    </>
  );
}
