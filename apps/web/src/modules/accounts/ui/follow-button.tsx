"use client";
/**
 * 追蹤切換按鈕（D19：追蹤≠收藏。追蹤＝上市與活動提醒、進個人行事曆）。遊戲詳情頁（game.actions）與
 * 活動、平台、系列、公司頁（entity.actions）共用。
 * 伺服器 HTML 與使用者無關：外殼先停用，掛載後取 session，已登入再打一次 `me/follows/state`；
 * 未登入按下導到登入頁（登入後回到這一頁）。按下時樂觀更新，失敗還原並顯示原因（達每日上限＝`follow_limit_reached`）。
 */
import { useEffect, useState, type ReactElement } from "react";
import type { FollowTarget } from "../domain/entities/follows";
import { getSession } from "./auth-api";
import { followTarget, getFollowState, unfollowTarget } from "./follow-api";
import { accountPageHref, safeNextPath } from "./links";
import { apiErrorText } from "./play-record-form";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export type SessionState = "loading" | "anonymous" | "user";

/** 取目前的登入狀態（頁面上已有別的元件取過時，改傳 `session` 給 FollowButton 就不重複請求）。 */
export function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("loading");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSession();
      if (alive) setState(res.ok && res.data?.user ? "user" : "anonymous");
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function CheckIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 8.5 3.2 3.2L13 4.8" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em" className="inline-block shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export interface FollowButtonProps {
  strings: AccountStrings;
  locale: string;
  targetType: FollowTarget;
  targetId: number;
  /** 按鈕下方的說明（省略＝不顯示；遊戲詳情頁由動作列統一說明）。 */
  hint?: string;
  /** 已由外層取得 session 時傳入，避免重複請求。 */
  session?: SessionState;
}

export function FollowButton({ strings, locale, targetType, targetId, hint, session: sessionProp }: FollowButtonProps): ReactElement {
  const own = useSessionState();
  const session = sessionProp ?? own;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (session !== "user") return;
    let alive = true;
    void (async () => {
      const res = await getFollowState([{ targetType, targetId }]);
      if (!alive) return;
      const item = res.ok ? res.data?.items.find((i) => i.targetType === targetType && i.targetId === targetId) : undefined;
      setFollowing(item ? item.following : false);
    })();
    return () => {
      alive = false;
    };
  }, [session, targetType, targetId]);

  async function onClick(): Promise<void> {
    if (session === "anonymous") {
      const here = safeNextPath(`${window.location.pathname}${window.location.search}`, `/${locale}/calendar`);
      window.location.assign(accountPageHref(locale, "login", `next=${encodeURIComponent(here)}`));
      return;
    }
    if (busy) return;
    const next = !(following ?? false);
    setBusy(true);
    setMessage(null);
    setFollowing(next); // 樂觀更新
    const res = next ? await followTarget(targetType, targetId) : await unfollowTarget(targetType, targetId);
    setBusy(false);
    if (res.ok) {
      setMessage({ tone: "ok", text: str(strings, next ? "follow.statusOn" : "follow.statusOff") });
      return;
    }
    setFollowing(!next); // 失敗：還原
    if (res.status === 401) {
      setMessage({ tone: "error", text: str(strings, "error.unauthorized") });
      return;
    }
    setMessage({ tone: "error", text: apiErrorText(strings, res) });
  }

  const pressed = following === true;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-follow-button={session === "user" ? (following === null ? "loading" : pressed ? "on" : "off") : session}>
      <div>
        <button
          type="button"
          className={`${pressed ? "btn-primary" : "btn-secondary"} inline-flex items-center gap-2`}
          aria-pressed={pressed}
          disabled={session === "loading" || busy || (session === "user" && following === null)}
          data-action="follow"
          onClick={() => void onClick()}
        >
          {pressed ? <CheckIcon /> : <PlusIcon />}
          {str(strings, "follow.button")}
        </button>
      </div>
      <p role="status" aria-live="polite" className={`min-h-5 text-sm ${message?.tone === "error" ? "text-[var(--danger)]" : ""}`}>
        {message?.text ?? ""}
      </p>
      {hint ? <p className="text-sm text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
