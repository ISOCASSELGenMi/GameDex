"use client";
/**
 * 帳號頁的「Steam 遊戲庫」區（09 §遊戲庫匯入）：個人檔案公開提示、匯入按鈕、匯入後的摘要與清單。
 * 比對在伺服器端背景進行（after() 與排程）：匯入後輪詢幾次摘要，讓「比對中」的數字更新。
 * 第 5 波：狀態篩選（伺服器端篩選，分頁照常）＋每列手動指定（待確認／找不到／已否決／已比對可更正）。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { OwnedGameStatus, OwnedGameView, OwnedGamesSummary } from "../domain/entities/owned-game";
import { getSteamLibrary, startSteamImport, type SteamLibraryResponse } from "./imports-api";
import { CONTROL_CLASS } from "./form-parts";
import { Modal } from "./modal";
import { SteamMatchDialogBody } from "./steam-match-dialog";
import { str } from "./str";
import type { AccountStrings } from "./strings";

const PAGE = 50;
const POLL_MS = 3000;
const POLL_MAX = 10;

type Notice = { tone: "ok" | "error"; text: string } | null;
type Filter = "all" | Exclude<OwnedGameStatus, "queued">;
const FILTERS: readonly Filter[] = ["all", "needs_review", "not_found", "dismissed", "matched"];

function filterCount(summary: OwnedGamesSummary, f: Filter): number {
  switch (f) {
    case "all":
      return summary.total;
    case "needs_review":
      return summary.needsReview;
    case "not_found":
      return summary.notFound;
    case "dismissed":
      return summary.dismissed;
    case "matched":
      return summary.matched;
  }
}

export function SteamLibrary({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [data, setData] = useState<SteamLibraryResponse | null>(null);
  const [items, setItems] = useState<OwnedGameView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [target, setTarget] = useState<OwnedGameView | null>(null);
  // 比對還在進行時（queued > 0）最多再輪詢幾次
  const [pollsLeft, setPollsLeft] = useState(POLL_MAX);
  const shown = useRef(PAGE);
  const noticeRef = useRef<HTMLDivElement>(null);
  const statusParam = filter === "all" ? undefined : filter;

  /** 把一次 GET 的結果套用到畫面（呼叫端已 await 過，不是在 effect 本體同步呼叫）。 */
  const apply = useCallback(
    (res: Awaited<ReturnType<typeof getSteamLibrary>>): void => {
      setLoaded(true);
      if (!res.ok || !res.data) {
        if (res.network) setNotice({ tone: "error", text: str(strings, "common.network") });
        else if (res.status !== 409) setNotice({ tone: "error", text: str(strings, "steam.error.load") });
        return;
      }
      setData(res.data);
      setItems(res.data.items);
      shown.current = res.data.items.length;
    },
    [strings],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getSteamLibrary(0, PAGE, statusParam);
      if (alive) apply(res);
    })();
    return () => {
      alive = false;
    };
  }, [apply, statusParam]);

  // 輪詢：重新載入「目前看到的這麼多筆」，清單不會縮回第一頁
  const queued = data?.summary.queued ?? 0;
  useEffect(() => {
    if (queued === 0 || pollsLeft <= 0) return;
    const t = setTimeout(async () => {
      apply(await getSteamLibrary(0, Math.min(100, Math.max(PAGE, shown.current)), statusParam));
      setPollsLeft((n) => n - 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [queued, pollsLeft, apply, statusParam]);

  async function onImport(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const res = await startSteamImport();
    setBusy(false);
    if (res.ok && res.data) {
      setNotice({ tone: "ok", text: str(strings, "steam.imported", { count: String(res.data.imported) }) });
      apply(await getSteamLibrary(0, PAGE, statusParam));
      setPollsLeft(POLL_MAX);
      return;
    }
    const code = res.code;
    let key = "steam.error.generic";
    if (res.network) key = "common.network";
    else if (code === "steam_profile_private") key = "steam.error.private";
    else if (code === "import_cooldown") key = "steam.error.cooldown";
    else if (code === "steam_import_unavailable") key = "steam.error.unavailable";
    else if (code === "steam_upstream_error") key = "steam.error.upstream";
    else if (code === "steam_not_linked") key = "steam.error.notLinked";
    else if (res.status === 401 || res.status === 403) key = "account.error.notFresh";
    setNotice({ tone: "error", text: str(strings, key) });
    if (code === "import_cooldown") apply(await getSteamLibrary(0, PAGE, statusParam));
  }

  async function onMore(): Promise<void> {
    setMore(true);
    const res = await getSteamLibrary(items.length, PAGE, statusParam);
    setMore(false);
    if (res.ok && res.data) {
      const next = res.data;
      setData(next);
      shown.current += next.items.length;
      setItems((prev) => [...prev, ...next.items]);
    } else setNotice({ tone: "error", text: str(strings, "steam.error.load") });
  }

  function onFilter(next: Filter): void {
    setFilter(next);
    setLoaded(false);
    setNotice(null);
  }

  function onMatchChanged(item: OwnedGameView, summary: OwnedGamesSummary, noticeKey: string): void {
    // 篩選中而該列已不屬於這個篩選：從清單移除；否則就地更新
    setItems((prev) => (filter !== "all" && item.status !== filter ? prev.filter((x) => x.id !== item.id) : prev.map((x) => (x.id === item.id ? item : x))));
    setData((d) => (d ? { ...d, summary } : d));
    setTarget(null);
    setNotice({ tone: "ok", text: str(strings, noticeKey, { title: item.title, name: item.game?.name ?? "" }) });
    // 對話框關閉後焦點本來回到該列的按鈕；列被移除或改變時，改放到結果訊息
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) noticeRef.current?.focus();
    }, 0);
  }

  const summary = data?.summary;
  const unavailable = data ? !data.importAvailable : false;
  const cooling = data ? data.cooldownSec > 0 : false;
  const disabled = busy || unavailable || cooling || !loaded;
  const reason = unavailable
    ? str(strings, "steam.unavailable")
    : cooling && data
      ? str(strings, "steam.cooldown", { minutes: String(Math.ceil(data.cooldownSec / 60)) })
      : null;

  return (
    <section aria-labelledby="steam-library-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="steam-library-heading" className="text-xl font-bold">
        {str(strings, "steam.title")}
      </h2>
      <div className="notice flex flex-col gap-1">
        <p>{str(strings, "steam.privacyNote")}</p>
        <p className="text-sm text-[var(--muted)]">{str(strings, "steam.privacyHow")}</p>
      </div>
      <p>
        <button type="button" className="btn-primary" disabled={disabled} aria-describedby={reason ? "steam-import-reason" : undefined} onClick={() => void onImport()}>
          {busy ? str(strings, "steam.importing") : summary && summary.total > 0 ? str(strings, "steam.reimport") : str(strings, "steam.import")}
        </button>
      </p>
      {reason ? (
        <p id="steam-import-reason" className="text-sm text-[var(--muted)]">
          {reason}
        </p>
      ) : null}
      <div ref={noticeRef} tabIndex={-1} aria-live="polite" role="status" className="min-h-6 outline-none">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>

      {summary && summary.total > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p data-testid="steam-summary" aria-live="polite">
            {str(strings, "steam.summary", {
              total: String(summary.total),
              matched: String(summary.matched),
              review: String(summary.needsReview),
              notFound: String(summary.notFound),
            })}
            {summary.dismissed > 0 ? ` ${str(strings, "steam.summaryDismissed", { dismissed: String(summary.dismissed) })}` : ""}
            {summary.queued > 0 ? ` ${str(strings, "steam.summaryQueued", { queued: String(summary.queued) })}` : ""}
          </p>
          <div className="flex flex-col gap-1 sm:max-w-sm">
            <label htmlFor="steam-filter" className="font-semibold">
              {str(strings, "steam.filter.label")}
            </label>
            <select id="steam-filter" className={CONTROL_CLASS} value={filter} onChange={(e) => onFilter(e.target.value as Filter)}>
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {str(strings, `steam.filter.${f}`, { count: String(filterCount(summary, f)) })}
                </option>
              ))}
            </select>
          </div>
          {items.length === 0 ? (
            loaded ? (
              <p className="text-[var(--muted)]">{str(strings, "steam.emptyFiltered")}</p>
            ) : (
              <p aria-live="polite">{str(strings, "common.loading")}</p>
            )
          ) : (
            <ul className="flex min-w-0 flex-col gap-1" aria-label={str(strings, "steam.listLabel")}>
              {items.map((it) => (
                <li key={it.id} className="relative flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border border-[var(--border)] px-3 py-2">
                  <span className="min-w-0 break-words">{it.title}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {it.status === "matched" && it.game ? (
                      <a className="link min-w-0 break-words" href={`/${locale}/games/${encodeURIComponent(it.game.slug)}`}>
                        {it.game.name}
                      </a>
                    ) : (
                      <span className="min-w-0 break-words text-[var(--muted)]">{str(strings, `steam.status.${it.status}`)}</span>
                    )}
                    {it.status !== "queued" ? (
                      <button type="button" className="btn-secondary" aria-haspopup="dialog" data-action="steam-match" onClick={() => setTarget(it)}>
                        {str(strings, it.status === "matched" ? "steam.match.open.matched" : "steam.match.open.other")}
                        <span className="sr-only"> {it.title}</span>
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data?.hasMore ? (
            <p>
              <button type="button" className="btn-secondary" disabled={more} onClick={() => void onMore()}>
                {str(strings, "steam.showMore")}
              </button>
            </p>
          ) : null}
        </div>
      ) : loaded ? (
        <p className="text-[var(--muted)]">{str(strings, "steam.empty")}</p>
      ) : (
        <p aria-live="polite">{str(strings, "common.loading")}</p>
      )}

      <Modal open={target !== null} onClose={() => setTarget(null)} title={str(strings, "steam.match.title")} closeLabel={str(strings, "common.close")}>
        {target ? <SteamMatchDialogBody key={target.id} strings={strings} locale={locale} item={target} onChanged={onMatchChanged} /> : null}
      </Modal>
    </section>
  );
}
