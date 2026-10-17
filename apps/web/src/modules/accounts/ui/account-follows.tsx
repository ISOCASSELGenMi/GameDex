"use client";
/**
 * `/[locale]/account/follows`：我的追蹤（D48：只有本人看得到）。依類型分頁籤（遊戲／活動／平台／系列／公司），
 * 每個類型各自載入、各自「顯示更多」；取消追蹤用樂觀更新（失敗還原）。
 * 目標已不存在（孤兒，等每晚清理）只顯示「已不存在的項目」與取消鈕。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { FOLLOW_TARGETS, type FollowTarget } from "../domain/entities/follows";
import { listFollows, unfollowTarget, type FollowListItem } from "./follow-api";
import { EventTime } from "@/kernel/ui/event-time";
import type { Locale } from "@sok/i18n";
import { followTargetHref } from "./follow-format";
import { GameLine } from "./game-thumb";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

const PAGE = 50;

type Notice = { tone: "ok" | "error"; text: string } | null;
interface TabState {
  items: FollowListItem[];
  hasMore: boolean;
  status: "idle" | "loading" | "ready" | "error";
  loadingMore: boolean;
}
const EMPTY_TAB: TabState = { items: [], hasMore: false, status: "idle", loadingMore: false };

export function AccountFollows({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <FollowsBody strings={strings} locale={locale} />
    </RequireUser>
  );
}

function FollowsBody({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [active, setActive] = useState<FollowTarget>("game");
  const [tabs, setTabs] = useState<Record<FollowTarget, TabState>>(() => Object.fromEntries(FOLLOW_TARGETS.map((t) => [t, EMPTY_TAB])) as Record<FollowTarget, TabState>);
  const [notice, setNotice] = useState<Notice>(null);
  const tabRefs = useRef<Partial<Record<FollowTarget, HTMLButtonElement | null>>>({});
  const loaded = useRef(new Set<FollowTarget>());

  const patchTab = useCallback((type: FollowTarget, f: (t: TabState) => TabState) => setTabs((all) => ({ ...all, [type]: f(all[type]) })), []);

  const load = useCallback(
    async (type: FollowTarget, offset: number) => {
      patchTab(type, (t) => (offset === 0 ? { ...t, status: "loading" } : { ...t, loadingMore: true }));
      const res = await listFollows(type, locale, offset, PAGE);
      if (res.ok && res.data) {
        const data = res.data;
        patchTab(type, (t) => ({ items: offset === 0 ? data.items : [...t.items, ...data.items], hasMore: data.hasMore, status: "ready", loadingMore: false }));
      } else {
        patchTab(type, (t) => ({ ...t, status: offset === 0 ? "error" : t.status, loadingMore: false }));
        if (offset > 0) setNotice({ tone: "error", text: apiErrorText(strings, res) });
      }
    },
    [locale, patchTab, strings],
  );

  useEffect(() => {
    if (loaded.current.has(active)) return;
    loaded.current.add(active);
    void load(active, 0);
  }, [active, load]);

  async function unfollow(item: FollowListItem): Promise<void> {
    const name = item.target?.name ?? str(strings, "follows.removed");
    setNotice(null);
    // 樂觀更新：先移除，失敗再放回原位
    const before = tabs[item.targetType].items;
    const index = before.findIndex((x) => x.targetId === item.targetId);
    patchTab(item.targetType, (t) => ({ ...t, items: t.items.filter((x) => x.targetId !== item.targetId) }));
    const res = await unfollowTarget(item.targetType, item.targetId);
    if (res.ok) {
      setNotice({ tone: "ok", text: str(strings, "follows.unfollowed", { name }) });
      return;
    }
    patchTab(item.targetType, (t) => {
      const next = [...t.items];
      next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
      return { ...t, items: next };
    });
    setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  // 分頁籤：左右鍵移動、Home／End 到頭尾（roving tabindex）
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % FOLLOW_TARGETS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + FOLLOW_TARGETS.length) % FOLLOW_TARGETS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = FOLLOW_TARGETS.length - 1;
    else return;
    e.preventDefault();
    const type = FOLLOW_TARGETS[next]!;
    setActive(type);
    tabRefs.current[type]?.focus();
  }

  const tab = tabs[active];
  const typeLabel = str(strings, `follows.type.${active}`);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-[var(--muted)]" data-testid="follows-private-note">
        {str(strings, "follows.note")}
      </p>
      <div role="tablist" aria-label={str(strings, "follows.tabsLabel")} className="flex flex-wrap gap-2">
        {FOLLOW_TARGETS.map((type, i) => (
          <button
            key={type}
            ref={(el) => {
              tabRefs.current[type] = el;
            }}
            type="button"
            role="tab"
            id={`follow-tab-${type}`}
            aria-selected={active === type}
            aria-controls="follow-panel"
            tabIndex={active === type ? 0 : -1}
            className={`${active === type ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActive(type)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {str(strings, `follows.type.${type}`)}
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
      <div role="tabpanel" id="follow-panel" aria-labelledby={`follow-tab-${active}`} tabIndex={-1} className="flex min-w-0 flex-col gap-3">
        {tab.status === "idle" || tab.status === "loading" ? <p aria-live="polite">{str(strings, "common.loading")}</p> : null}
        {tab.status === "error" ? (
          <p role="alert" className="text-[var(--danger)]">
            {str(strings, "follows.loadError")}
          </p>
        ) : null}
        {tab.status === "ready" && tab.items.length === 0 ? <p className="text-[var(--muted)]">{str(strings, "follows.empty")}</p> : null}
        {tab.items.length > 0 ? (
          <ul className="flex min-w-0 flex-col gap-3" aria-label={str(strings, "follows.listLabel", { type: typeLabel })} data-follow-type={active}>
            {tab.items.map((item) => (
              <li key={`${item.targetType}:${item.targetId}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3" data-follow-id={item.targetId}>
                <FollowRow strings={strings} locale={locale} item={item} />
                <button type="button" className="btn-secondary" onClick={() => void unfollow(item)}>
                  {str(strings, "follows.unfollow")}
                  <span className="sr-only"> {item.target?.name ?? str(strings, "follows.removed")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {tab.hasMore ? (
          <p>
            <button type="button" className="btn-secondary" disabled={tab.loadingMore} onClick={() => void load(active, tab.items.length)}>
              {tab.loadingMore ? str(strings, "common.loading") : str(strings, "follows.loadMore")}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FollowRow({ strings, locale, item }: { strings: AccountStrings; locale: string; item: FollowListItem }): ReactElement {
  const t = item.target;
  if (!t) return <span className="min-w-0 text-[var(--muted)]">{str(strings, "follows.removed")}</span>;
  if (item.targetType === "game") {
    return (
      <span className="min-w-0 flex-1">
        <GameLine game={{ id: t.targetId, slug: t.slug, name: t.name, originalName: t.originalName, cover: t.cover, firstReleaseDate: t.firstReleaseDate }} locale={locale} />
      </span>
    );
  }
  const meta =
    item.targetType === "event" && t.startTime
      ? <EventTime startIso={t.startTime} locale={locale as Locale} />
      : item.targetType === "platform"
        ? t.abbreviation
        : item.targetType === "franchise" && t.kind === "collection"
          ? str(strings, "follows.collection")
          : null;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <a className="link font-semibold [overflow-wrap:anywhere]" href={followTargetHref(locale, { targetType: item.targetType, slug: t.slug, kind: t.kind })}>
        {t.name}
      </a>
      {meta ? <span className="text-sm text-[var(--muted)]">{meta}</span> : null}
    </span>
  );
}
