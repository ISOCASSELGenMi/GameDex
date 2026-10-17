"use client";
/** `/[locale]/account/lists/[id]`：清單內容（遊戲卡片、加註編輯、上下移動排序、移除）。 */
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { LIST_NOTE_MAX } from "../domain/entities/lists";
import { ConfirmButton } from "./confirm-button";
import { getList, reorderListGames, removeGameFromList, setListGameNote, type ListDetailResponse, type ListGameEntryView } from "./data-api";
import { CONTROL_CLASS, Field } from "./form-parts";
import { GameLine } from "./game-thumb";
import { accountListsHref, publicListHref } from "./links";
import { fieldErrorText } from "./play-format";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type Notice = { tone: "ok" | "error"; text: string } | null;
const PAGE = 100;

export function AccountListDetail({ strings, locale, listId }: { strings: AccountStrings; locale: string; listId: number }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <DetailBody strings={strings} locale={locale} listId={listId} />
    </RequireUser>
  );
}

function DetailBody({ strings, locale, listId }: { strings: AccountStrings; locale: string; listId: number }): ReactElement {
  const [data, setData] = useState<ListDetailResponse | null>(null);
  const [games, setGames] = useState<ListGameEntryView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [notice, setNotice] = useState<Notice>(null);
  const [more, setMore] = useState(false);
  const [editingNote, setEditingNote] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getList(listId, locale, 0, PAGE);
      if (!alive) return;
      if (res.ok && res.data && res.data.isOwner) {
        setData(res.data);
        setGames(res.data.games);
        setState("ready");
      } else setState(res.status === 404 || (res.ok && res.data && !res.data.isOwner) ? "missing" : "error");
    })();
    return () => {
      alive = false;
    };
  }, [listId, locale]);

  if (state === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state === "error") return <p role="alert" className="text-[var(--danger)]">{str(strings, "list.error.load")}</p>;
  if (state === "missing" || !data) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert">{str(strings, "list.notFound")}</p>
        <p>
          <a className="link" href={accountListsHref(locale)}>
            {str(strings, "list.backToLists")}
          </a>
        </p>
      </div>
    );
  }

  const list = data.list;

  async function loadMore(): Promise<void> {
    setMore(true);
    const res = await getList(listId, locale, games.length, PAGE);
    setMore(false);
    if (res.ok && res.data) {
      const next = res.data;
      setGames((g) => [...g, ...next.games]);
      setData((d) => (d ? { ...d, hasMore: next.hasMore } : d));
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  async function move(index: number, delta: -1 | 1): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= games.length) return;
    const next = [...games];
    [next[index], next[target]] = [next[target]!, next[index]!];
    const res = await reorderListGames(listId, next.map((g) => g.gameId));
    if (res.ok) {
      setGames(next);
      setNotice({ tone: "ok", text: str(strings, "list.gameMoved", { name: games[index]!.game?.name ?? "", position: String(target + 1) }) });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  async function remove(entry: ListGameEntryView): Promise<void> {
    const res = await removeGameFromList(listId, entry.gameId);
    if (res.ok) {
      setGames((g) => g.filter((x) => x.gameId !== entry.gameId));
      setData((d) => (d ? { ...d, list: { ...d.list, gameCount: Math.max(0, d.list.gameCount - 1) } } : d));
      setNotice({ tone: "ok", text: str(strings, "list.gameRemoved", { name: entry.game?.name ?? "" }) });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold [overflow-wrap:anywhere]" data-testid="list-name">
          {list.name}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {str(strings, `list.visibility.${list.visibility}`)} ・ {str(strings, "list.gameCount", { count: String(list.gameCount) })}
        </p>
        {list.description ? <p className="[overflow-wrap:anywhere]">{list.description}</p> : null}
        <p className="flex flex-wrap gap-x-4">
          <a className="link inline-flex min-h-11 items-center" href={accountListsHref(locale)}>
            {str(strings, "list.backToLists")}
          </a>
          {list.visibility !== "private" ? (
            <a className="link inline-flex min-h-11 items-center" href={publicListHref(locale, list)}>
              {str(strings, "list.viewPublic")}
            </a>
          ) : null}
        </p>
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
      {games.length === 0 ? (
        <p className="text-[var(--muted)]">{str(strings, "list.emptyGames")}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3" aria-label={str(strings, "list.gamesLabel")}>
          {games.map((g, i) => {
            const name = g.game?.name ?? String(g.gameId);
            return (
              <li key={g.gameId} className="relative flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-3" data-game-id={g.gameId}>
                {g.game ? <GameLine game={g.game} locale={locale} /> : <span>{name}</span>}
                {editingNote === g.gameId ? (
                  <NoteForm
                    strings={strings}
                    listId={listId}
                    entry={g}
                    onSaved={(note) => {
                      setGames((all) => all.map((x) => (x.gameId === g.gameId ? { ...x, note } : x)));
                      setEditingNote(null);
                      setNotice({ tone: "ok", text: str(strings, "list.noteSaved", { name }) });
                    }}
                    onCancel={() => setEditingNote(null)}
                  />
                ) : (
                  <>
                    {g.note ? <p className="text-sm [overflow-wrap:anywhere]">{g.note}</p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn-secondary" onClick={() => setEditingNote(g.gameId)}>
                        {g.note ? str(strings, "list.noteEdit") : str(strings, "list.noteAdd")}
                        <span className="sr-only"> {name}</span>
                      </button>
                      <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => void move(i, -1)}>
                        {str(strings, "list.moveUp")}
                        <span className="sr-only"> {name}</span>
                      </button>
                      <button type="button" className="btn-secondary" disabled={i === games.length - 1} onClick={() => void move(i, 1)}>
                        {str(strings, "list.moveDown")}
                        <span className="sr-only"> {name}</span>
                      </button>
                      <ConfirmButton strings={strings} label={str(strings, "list.gameRemove")} srContext={name} confirmText={str(strings, "list.confirmRemoveGame", { name })} onConfirm={() => remove(g)} />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.hasMore ? (
        <p>
          <button type="button" className="btn-secondary" disabled={more} onClick={() => void loadMore()}>
            {str(strings, "list.showMore")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function NoteForm({ strings, listId, entry, onSaved, onCancel }: { strings: AccountStrings; listId: number; entry: ListGameEntryView; onSaved: (note: string | null) => void; onCancel: () => void }): ReactElement {
  const [note, setNote] = useState(entry.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const value = note.trim() === "" ? null : note.trim();
    const res = await setListGameNote(listId, entry.gameId, value);
    setBusy(false);
    if (res.ok) onSaved(value);
    else if (res.code === "validation_failed" && res.fields?.note) setError(fieldErrorText(strings, res.fields.note));
    else setError(apiErrorText(strings, res));
  }

  const id = `note-${entry.gameId}`;
  return (
    <form className="flex min-w-0 flex-col gap-2" noValidate onSubmit={(e) => void submit(e)}>
      <Field id={id} label={str(strings, "list.noteLabel", { name: entry.game?.name ?? "" })} hint={str(strings, "list.noteHint", { limit: String(LIST_NOTE_MAX) })} error={error}>
        {({ id: fid, describedBy, invalid }) => (
          <textarea id={fid} rows={2} maxLength={LIST_NOTE_MAX} className={`${CONTROL_CLASS} py-2`} value={note} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setNote(e.target.value)} autoFocus />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? str(strings, "list.saving") : str(strings, "list.save")}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          {str(strings, "common.cancel")}
        </button>
      </div>
    </form>
  );
}
