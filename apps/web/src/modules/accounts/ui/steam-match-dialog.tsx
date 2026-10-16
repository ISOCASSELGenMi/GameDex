"use client";
/**
 * Steam 遊戲庫的手動指定對話框（09 §遊戲庫匯入；Phase 7 第 5 波）。
 * 先列自動比對的候選（含信心），可自行搜尋（games/search）；選定後 PATCH {gameId}，
 * 「這不是任何遊戲」＝{gameId:null}（否決，不再自動比對）、「交給自動比對」＝{reset:true}。
 */
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { GameMiniCard } from "@/modules/catalog";
import type { OwnedGameView, OwnedGamesSummary } from "../domain/entities/owned-game";
import { getMatchCandidates, patchOwnedGame, searchGames, type ManualMatchBody, type MatchCandidate } from "./imports-api";
import { CONTROL_CLASS } from "./form-parts";
import { GameThumb } from "./game-thumb";
import { apiErrorText } from "./play-record-form";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export interface SteamMatchDialogProps {
  strings: AccountStrings;
  locale: string;
  item: OwnedGameView;
  /** 變更成功：新的列與摘要。 */
  onChanged: (item: OwnedGameView, summary: OwnedGamesSummary, noticeKey: string) => void;
}

const yearOf = (g: GameMiniCard): string => (g.firstReleaseDate ? g.firstReleaseDate.slice(0, 4) : "");

export function SteamMatchDialogBody({ strings, locale, item, onChanged }: SteamMatchDialogProps): ReactElement {
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GameMiniCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getMatchCandidates(item.id, locale);
      if (!alive) return;
      if (res.ok && res.data) setCandidates(res.data.items);
      else {
        setCandidates([]);
        setCandidatesFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [item.id, locale]);

  async function apply(body: ManualMatchBody, noticeKey: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    const res = await patchOwnedGame(item.id, body);
    setBusy(false);
    if (res.ok && res.data) onChanged(res.data.item, res.data.summary, noticeKey);
    else setMessage(apiErrorText(strings, res));
  }

  async function onSearch(e: FormEvent): Promise<void> {
    e.preventDefault();
    const q = query.trim();
    if ([...q].length < 2) {
      setResults(null);
      setMessage(str(strings, "steam.match.queryTooShort"));
      return;
    }
    setSearching(true);
    setMessage(null);
    const res = await searchGames(q, locale);
    setSearching(false);
    if (res.ok && res.data) setResults(res.data.items);
    else setMessage(res.network ? str(strings, "common.network") : str(strings, "steam.match.searchFailed"));
  }

  const choose = (g: GameMiniCard) => void apply({ gameId: g.id }, "steam.match.done.assigned");
  const current = item.game;

  return (
    <>
      <p className="[overflow-wrap:anywhere]">
        {str(strings, "steam.match.steamTitle")}
        <strong>{item.title}</strong>
      </p>
      {current ? (
        <p className="text-sm text-[var(--muted)]">{str(strings, "steam.match.current", { name: current.name })}</p>
      ) : null}
      <div role="status" aria-live="polite" className="min-h-6">
        {message ? <p className="text-[var(--danger)]">{message}</p> : null}
      </div>

      <section aria-labelledby="match-candidates-heading" className="flex min-w-0 flex-col gap-2">
        <h3 id="match-candidates-heading" className="font-bold">
          {str(strings, "steam.match.candidates")}
        </h3>
        {candidates === null ? (
          <p aria-live="polite">{str(strings, "common.loading")}</p>
        ) : candidates.length === 0 ? (
          <p className="text-[var(--muted)]">{str(strings, candidatesFailed ? "steam.match.candidatesFailed" : "steam.match.candidatesNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <GameChoice key={c.game.id} strings={strings} game={c.game} meta={c.confidencePct > 0 ? str(strings, "steam.match.confidence", { pct: String(c.confidencePct) }) : undefined} busy={busy} onChoose={() => choose(c.game)} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="match-search-heading" className="flex min-w-0 flex-col gap-2 border-t border-[var(--border)] pt-3">
        <h3 id="match-search-heading" className="font-bold">
          {str(strings, "steam.match.search")}
        </h3>
        <form className="flex flex-wrap items-end gap-2" role="search" noValidate onSubmit={(e) => void onSearch(e)}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="match-query" className="font-semibold">
              {str(strings, "steam.match.searchLabel")}
            </label>
            <input id="match-query" type="search" className={CONTROL_CLASS} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button type="submit" className="btn-secondary" disabled={searching}>
            {searching ? str(strings, "steam.match.searching") : str(strings, "steam.match.searchButton")}
          </button>
        </form>
        {results !== null ? (
          results.length === 0 ? (
            <p className="text-[var(--muted)]">{str(strings, "steam.match.searchNone")}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={str(strings, "steam.match.searchResults")}>
              {results.map((g) => (
                <GameChoice key={g.id} strings={strings} game={g} busy={busy} onChoose={() => choose(g)} />
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section className="flex min-w-0 flex-col gap-2 border-t border-[var(--border)] pt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void apply({ gameId: null }, "steam.match.done.dismissed")}>
            {str(strings, "steam.match.dismiss")}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void apply({ reset: true }, "steam.match.done.reset")}>
            {str(strings, "steam.match.reset")}
          </button>
        </div>
        <p className="text-sm text-[var(--muted)]">{str(strings, "steam.match.actionsHint")}</p>
      </section>
    </>
  );
}

function GameChoice({ strings, game, meta, busy, onChoose }: { strings: AccountStrings; game: GameMiniCard; meta?: string; busy: boolean; onChoose: () => void }): ReactElement {
  const year = yearOf(game);
  return (
    <li className="relative flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <GameThumb game={game} size={36} />
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold [overflow-wrap:anywhere]">{game.name}</span>
          {year || meta ? <span className="text-sm text-[var(--muted)]">{[year, meta].filter(Boolean).join(" ・ ")}</span> : null}
        </span>
      </span>
      <button type="button" className="btn-primary shrink-0" disabled={busy} onClick={onChoose}>
        {str(strings, "steam.match.choose")}
        <span className="sr-only"> {game.name}</span>
      </button>
    </li>
  );
}
