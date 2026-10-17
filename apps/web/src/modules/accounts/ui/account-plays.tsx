"use client";
/** `/[locale]/account/plays`：遊玩紀錄（依更新時間、顯示更多）＋統計；編輯／刪除與詳情頁共用同一個表單與摘要元件。 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { GamePlatformOption } from "@/modules/catalog";
import { PLAY_STATUSES, type PlayRecordView, type PlayStatsView } from "../domain/entities/play-records";
import { getMyGameState, getPlayRecords, getPlayStats, type PlayRecordWithGame } from "./data-api";
import { GameLine } from "./game-thumb";
import { Modal } from "./modal";
import { formatPlayTime, playStatusLabel } from "./play-format";
import { PlayRecordForm, PlayRecordSummary, apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type Notice = { tone: "ok" | "error"; text: string } | null;
const PAGE = 50;

export function AccountPlays({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <PlaysBody strings={strings} locale={locale} />
    </RequireUser>
  );
}

function PlaysBody({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [items, setItems] = useState<PlayRecordWithGame[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<PlayStatsView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<{ record: PlayRecordWithGame; platforms: GamePlatformOption[] | null; failed: boolean } | null>(null);
  const [platformsByGame, setPlatformsByGame] = useState<Record<number, GamePlatformOption[]>>({});

  const refreshStats = useCallback(async () => {
    const s = await getPlayStats();
    if (s.ok && s.data) setStats(s.data);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [r, s] = await Promise.all([getPlayRecords(locale, 0, PAGE), getPlayStats()]);
      if (!alive) return;
      if (r.ok && r.data) {
        setItems(r.data.items);
        setHasMore(r.data.hasMore);
        if (s.ok && s.data) setStats(s.data);
        setState("ready");
      } else setState("error");
    })();
    return () => {
      alive = false;
    };
  }, [locale]);

  async function loadMore(): Promise<void> {
    setMore(true);
    const r = await getPlayRecords(locale, items.length, PAGE);
    setMore(false);
    if (r.ok && r.data) {
      const next = r.data;
      setItems((all) => [...all, ...next.items]);
      setHasMore(next.hasMore);
    } else setNotice({ tone: "error", text: apiErrorText(strings, r) });
  }

  async function openEditor(record: PlayRecordWithGame): Promise<void> {
    setNotice(null);
    const cached = platformsByGame[record.gameId];
    setEditing({ record, platforms: cached ?? null, failed: false });
    if (cached) return;
    const g = await getMyGameState(record.gameId);
    if (g.ok && g.data) {
      const platforms = g.data.platforms;
      setPlatformsByGame((m) => ({ ...m, [record.gameId]: platforms }));
      setEditing((cur) => (cur && cur.record.id === record.id ? { ...cur, platforms } : cur));
    } else setEditing((cur) => (cur && cur.record.id === record.id ? { ...cur, failed: true } : cur));
  }

  function onSaved(saved: PlayRecordView): void {
    setItems((all) => all.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
    setEditing(null);
    setNotice({ tone: "ok", text: str(strings, "play.updated") });
    void refreshStats();
  }

  if (state === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state === "error") return <p role="alert" className="text-[var(--danger)]">{str(strings, "play.error.load")}</p>;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {stats ? (
        <section aria-labelledby="play-stats-heading" className="flex min-w-0 flex-col gap-2">
          <h2 id="play-stats-heading" className="text-xl font-bold">
            {str(strings, "play.stats.title")}
          </h2>
          <dl className="grid grid-cols-[minmax(0,1fr)_max-content] gap-x-4 gap-y-1 sm:max-w-md" data-testid="play-stats">
            {PLAY_STATUSES.map((s) => (
              <div key={s} className="contents">
                <dt>{playStatusLabel(strings, s)}</dt>
                <dd className="text-right font-semibold" data-stat={s}>
                  {stats.byStatus[s]}
                </dd>
              </div>
            ))}
            <dt className="border-t border-[var(--border)] pt-1">{str(strings, "play.stats.finishedThisYear", { year: String(stats.year) })}</dt>
            <dd className="border-t border-[var(--border)] pt-1 text-right font-semibold" data-stat="finishedThisYear">
              {stats.finishedThisYear}
            </dd>
            <dt>{str(strings, "play.stats.totalTime")}</dt>
            <dd className="text-right font-semibold" data-stat="totalTime">
              {formatPlayTime(strings, stats.totalPlayMinutes)}
            </dd>
          </dl>
          <p className="text-sm text-[var(--muted)]">{str(strings, "play.stats.note")}</p>
        </section>
      ) : null}

      <section aria-labelledby="play-records-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="play-records-heading" className="text-xl font-bold">
          {str(strings, "play.recordsTitle")}
        </h2>
        <div role="status" aria-live="polite" className="min-h-6">
          {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
        </div>
        {items.length === 0 ? (
          <p className="text-[var(--muted)]">{str(strings, "play.empty")}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3" aria-label={str(strings, "play.listLabel")}>
            {items.map((r) => (
              <li key={r.id} className="relative flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-3" data-record-id={r.id}>
                {r.game ? <GameLine game={r.game} locale={locale} /> : null}
                <PlayRecordSummary
                  strings={strings}
                  locale={locale}
                  record={r}
                  platforms={platformsByGame[r.gameId] ?? []}
                  onEdit={() => void openEditor(r)}
                  onDeleted={(id) => {
                    setItems((all) => all.filter((x) => x.id !== id));
                    void refreshStats();
                  }}
                  onMessage={(text, tone) => setNotice({ tone, text })}
                />
              </li>
            ))}
          </ul>
        )}
        {hasMore ? (
          <p>
            <button type="button" className="btn-secondary" disabled={more} onClick={() => void loadMore()}>
              {str(strings, "play.showMore")}
            </button>
          </p>
        ) : null}
      </section>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={str(strings, "play.editTitle")} closeLabel={str(strings, "common.close")}>
        {editing ? (
          editing.platforms ? (
            <PlayRecordForm strings={strings} locale={locale} gameId={editing.record.gameId} platforms={editing.platforms} record={editing.record} onSaved={onSaved} onCancel={() => setEditing(null)} />
          ) : editing.failed ? (
            <p role="alert" className="text-[var(--danger)]">
              {str(strings, "play.error.load")}
            </p>
          ) : (
            <p aria-live="polite">{str(strings, "common.loading")}</p>
          )
        ) : null}
      </Modal>
    </div>
  );
}
