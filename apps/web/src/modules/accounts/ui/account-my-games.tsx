"use client";
/**
 * `/[locale]/account/games`：我的遊戲。切換「追蹤的／擁有的／收藏的／某一份清單」，可選上市日期範圍，
 * 依最近的上市日排序（後端 `GET /api/v1/me/games` 用月曆同一套聚合規則）。
 * 這頁是月曆／時間軸／瀏覽頁「我的遊戲」篩選的入口（那三頁維持與使用者無關、可被 CDN 快取；R 待決 1）。
 * 來源與日期範圍寫在網址（`?mine=followed&from=&to=`，replaceState），可分享給自己、重新整理保留。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { MyGameItem } from "@/modules/catalog";
import type { ListSummaryView } from "../domain/entities/lists";
import { getMyLists } from "./data-api";
import { getMyGames } from "./follow-api";
import { checkDateRange, formatMyGameDate, mineValue, type ReleasePrecision } from "./follow-format";
import { CONTROL_CLASS } from "./form-parts";
import { GameLine } from "./game-thumb";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

const PAGE = 24;
type Status = "loading" | "ready" | "error";

export function AccountMyGames({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <MyGamesBody strings={strings} locale={locale} />
    </RequireUser>
  );
}

function initialFromUrl(): { source: string; from: string; to: string } {
  const p = new URLSearchParams(window.location.search);
  const first = (p.get("mine") ?? "").split(",").map((v) => mineValue(v.trim())).find((v) => v !== null);
  return { source: first ?? "followed", from: p.get("from") ?? "", to: p.get("to") ?? "" };
}

function MyGamesBody({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [init] = useState(initialFromUrl);
  const [source, setSource] = useState(init.source);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [lists, setLists] = useState<ListSummaryView[]>([]);
  // 第一頁的結果連同它對應的條件（key）一起存；key 與目前條件不同＝載入中（不必在 effect 內同步 setState）
  const [first, setFirst] = useState<{ key: string; items: MyGameItem[]; total: number; hasMore: boolean; ok: boolean } | null>(null);
  const [extra, setExtra] = useState<{ key: string; items: MyGameItem[] }>({ key: "", items: [] });
  const [lastPage, setLastPage] = useState<{ key: string; total: number; hasMore: boolean } | null>(null);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const seq = useRef(0);

  const rangeError = checkDateRange(from, to);
  const key = `${source}|${from}|${to}`;
  const current = first && first.key === key ? first : null;
  const status: Status = current ? (current.ok ? "ready" : "error") : "loading";
  const items = current ? [...current.items, ...(extra.key === key ? extra.items : [])] : [];
  const paging = lastPage && lastPage.key === key ? lastPage : current;
  const total = paging?.total ?? 0;
  const hasMore = paging?.hasMore ?? false;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getMyLists();
      if (alive && res.ok && res.data) setLists(res.data.items);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 來源或範圍變動 → 重新載入第一頁，並把條件寫回網址
  useEffect(() => {
    if (rangeError) return;
    const mine = mineValue(source);
    if (!mine) return;
    const mySeq = ++seq.current;
    const q = new URLSearchParams({ mine: source });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
    void (async () => {
      const res = await getMyGames({ mine: [mine], from: from || undefined, to: to || undefined, limit: PAGE }, locale);
      if (mySeq !== seq.current) return; // 已有較新的請求
      if (res.ok && res.data) setFirst({ key, items: res.data.items, total: res.data.total, hasMore: res.data.hasMore, ok: true });
      else if (res.status === 404 && res.code === "list_not_found") setSource("followed"); // 清單已被刪除：退回「追蹤的」
      else setFirst({ key, items: [], total: 0, hasMore: false, ok: false });
    })();
  }, [source, from, to, rangeError, locale, key]);

  const loadMore = useCallback(async () => {
    const mine = mineValue(source);
    if (!mine) return;
    setMore(true);
    setMoreError(null);
    const res = await getMyGames({ mine: [mine], from: from || undefined, to: to || undefined, limit: PAGE, offset: items.length }, locale);
    setMore(false);
    if (res.ok && res.data) {
      const next = res.data;
      setExtra((e) => ({ key, items: [...(e.key === key ? e.items : []), ...next.items] }));
      setLastPage({ key, total: next.total, hasMore: next.hasMore });
    } else setMoreError(apiErrorText(strings, res));
  }, [source, from, to, key, items.length, locale, strings]);

  const options: { value: string; label: string }[] = [
    { value: "followed", label: str(strings, "mygames.source.followed") },
    { value: "owned", label: str(strings, "mygames.source.owned") },
    { value: "collected", label: str(strings, "mygames.source.collected") },
    ...lists.map((l) => ({ value: `list:${l.id}`, label: str(strings, "mygames.source.list", { name: l.name }) })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-[var(--muted)]">{str(strings, "mygames.note")}</p>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="font-semibold">{str(strings, "mygames.sourceLabel")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {options.map((o) => (
            <label key={o.value} className="inline-flex min-h-11 min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
              <input type="radio" name="mine-source" value={o.value} checked={source === o.value} onChange={() => setSource(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        {source === "followed" ? <p className="text-sm text-[var(--muted)]">{str(strings, "mygames.followedHint")}</p> : null}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="font-semibold">{str(strings, "mygames.rangeLabel")}</legend>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="mg-from" className="text-sm">
              {str(strings, "mygames.from")}
            </label>
            <input id="mg-from" type="date" className={`${CONTROL_CLASS} w-auto`} value={from} aria-invalid={rangeError !== null} aria-describedby={rangeError ? "mg-range-err" : undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="mg-to" className="text-sm">
              {str(strings, "mygames.to")}
            </label>
            <input id="mg-to" type="date" className={`${CONTROL_CLASS} w-auto`} value={to} aria-invalid={rangeError !== null} aria-describedby={rangeError ? "mg-range-err" : undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          {from || to ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              {str(strings, "mygames.clearRange")}
            </button>
          ) : null}
        </div>
        {rangeError ? (
          <p id="mg-range-err" role="alert" className="text-sm text-[var(--danger)]">
            {str(strings, rangeError === "before_from" ? "mygames.badRange" : "error.field.invalid")}
          </p>
        ) : null}
      </fieldset>

      <p role="status" aria-live="polite" className="min-h-6 text-sm text-[var(--muted)]" data-testid="mygames-count">
        {status === "loading" ? str(strings, "common.loading") : status === "ready" ? str(strings, "mygames.count", { count: String(total) }) : ""}
      </p>
      {status === "error" ? (
        <p role="alert" className="text-[var(--danger)]">
          {str(strings, "mygames.loadError")}
        </p>
      ) : null}
      {status === "ready" && items.length === 0 ? <p className="text-[var(--muted)]">{str(strings, "mygames.empty")}</p> : null}
      {items.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-3" aria-label={str(strings, "mygames.listLabel")} aria-busy={status === "loading"}>
          {items.map((it) => (
            <li key={it.game.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-3" data-game-id={it.game.id}>
              <GameLine game={it.game} locale={locale} meta={<ReleaseMeta strings={strings} locale={locale} item={it} />} />
            </li>
          ))}
        </ul>
      ) : null}
      {moreError ? (
        <p role="alert" className="text-[var(--danger)]">
          {moreError}
        </p>
      ) : null}
      {hasMore && status === "ready" ? (
        <p>
          <button type="button" className="btn-secondary" disabled={more} onClick={() => void loadMore()}>
            {more ? str(strings, "common.loading") : str(strings, "mygames.loadMore")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** 最近上市日的一行描述：日期（或未定／過去）＋平台＋狀態。 */
function ReleaseMeta({ strings, locale, item }: { strings: AccountStrings; locale: string; item: MyGameItem }): ReactElement {
  const r = item.nextRelease;
  if (!r) return <span>{str(strings, "mygames.noRelease")}</span>;
  const date = formatMyGameDate(strings, locale, r.date, r.precision as ReleasePrecision);
  const dateText = r.relation === "past" ? str(strings, "mygames.past", { date }) : r.relation === "tbd" ? str(strings, "mygames.tbd") : date;
  const statusText = r.status === "scheduled" ? "" : str(strings, `mygames.status.${r.status}`);
  const platforms = r.platforms.map((p) => p.abbreviation ?? p.name).join(" / ");
  return (
    <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]" data-relation={r.relation}>
      <span>{[dateText, statusText].filter(Boolean).join(" ・ ")}</span>
      {platforms ? <span>{platforms}</span> : null}
    </span>
  );
}
