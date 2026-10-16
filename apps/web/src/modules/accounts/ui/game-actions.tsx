"use client";
/**
 * 遊戲詳情頁動作列（slot `game.actions`）：「加入清單」「記錄遊玩」兩個分開的按鈕。
 * 這兩者是「收藏與紀錄」，不是「追蹤」（D19；追蹤另有功能，不會因為加進清單而出現在行事曆）。
 * 伺服器 HTML 與使用者無關（按鈕先停用）；掛載後取 session，已登入再打一次 /api/v1/me/games/{gameId}。
 */
import { useEffect, useState, type ReactElement } from "react";
import type { PlayRecordView } from "../domain/entities/play-records";
import { getSession } from "./auth-api";
import { getMyGameState, type MyGameState } from "./data-api";
import { ListPicker, type GameListRow } from "./list-picker";
import { accountListsHref, accountPageHref, accountPlaysHref, safeNextPath } from "./links";
import { Modal } from "./modal";
import { PlayRecordForm, PlayRecordSummary } from "./play-record-form";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type Session = "loading" | "anonymous" | "user";
type DialogKind = "lists" | "plays" | null;

export function GameActions({ strings, locale, gameId }: { strings: AccountStrings; locale: string; gameId: number }): ReactElement {
  const [session, setSession] = useState<Session>("loading");
  const [state, setState] = useState<MyGameState | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSession();
      if (!alive) return;
      if (!(s.ok && s.data?.user)) {
        setSession("anonymous");
        return;
      }
      const g = await getMyGameState(gameId);
      if (!alive) return;
      if (g.status === 401) setSession("anonymous");
      else {
        setSession("user");
        if (g.ok && g.data) setState(g.data);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId]);

  function open(kind: Exclude<DialogKind, null>): void {
    if (session === "anonymous") {
      // 登入後回到這一頁
      const here = safeNextPath(`${window.location.pathname}${window.location.search}`, `/${locale}/calendar`);
      window.location.assign(accountPageHref(locale, "login", `next=${encodeURIComponent(here)}`));
      return;
    }
    setDialog(kind);
  }

  const inLists = state?.lists.filter((l) => l.contains).length ?? 0;
  const records = state?.playRecords.length ?? 0;
  const disabled = session === "loading";

  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-game-actions={session}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" aria-haspopup="dialog" disabled={disabled} data-action="add-to-list" onClick={() => open("lists")}>
          {str(strings, "game.addToList")}
        </button>
        <button type="button" className="btn-secondary" aria-haspopup="dialog" disabled={disabled} data-action="log-play" onClick={() => open("plays")}>
          {str(strings, "game.logPlay")}
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">{str(strings, "game.notTracking")}</p>
      {session === "user" && (inLists > 0 || records > 0) ? (
        <p className="text-sm" data-testid="game-actions-summary">
          {[inLists > 0 ? str(strings, "game.inLists", { count: String(inLists) }) : null, records > 0 ? str(strings, "game.playCount", { count: String(records) }) : null].filter(Boolean).join(" ・ ")}
        </p>
      ) : null}

      <Modal open={dialog === "lists"} onClose={() => setDialog(null)} title={str(strings, "game.addToList")} closeLabel={str(strings, "common.close")}>
        {state ? (
          <ListPicker strings={strings} gameId={gameId} lists={state.lists} manageHref={accountListsHref(locale)} onChange={(lists: GameListRow[]) => setState({ ...state, lists })} />
        ) : (
          <p role="alert" className="text-[var(--danger)]">
            {str(strings, "game.loadError")}
          </p>
        )}
      </Modal>
      <Modal open={dialog === "plays"} onClose={() => setDialog(null)} title={str(strings, "game.logPlay")} closeLabel={str(strings, "common.close")}>
        {state ? (
          <PlayDialogBody
            strings={strings}
            locale={locale}
            gameId={gameId}
            state={state}
            onRecords={(playRecords) => setState({ ...state, playRecords })}
            onClose={() => setDialog(null)}
          />
        ) : (
          <p role="alert" className="text-[var(--danger)]">
            {str(strings, "game.loadError")}
          </p>
        )}
      </Modal>
    </div>
  );
}

function PlayDialogBody({
  strings,
  locale,
  gameId,
  state,
  onRecords,
  onClose,
}: {
  strings: AccountStrings;
  locale: string;
  gameId: number;
  state: MyGameState;
  onRecords: (records: PlayRecordView[]) => void;
  onClose: () => void;
}): ReactElement {
  // 沒有紀錄時直接開新增表單
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "form"; record: PlayRecordView | null }>(state.playRecords.length === 0 ? { kind: "form", record: null } : { kind: "list" });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const records = state.playRecords;

  function backToList(): void {
    if (records.length === 0) onClose();
    else setMode({ kind: "list" });
  }

  return (
    <>
      <div role="status" aria-live="polite" className="min-h-6">
        {message ? <p className={message.tone === "error" ? "text-[var(--danger)]" : ""}>{message.text}</p> : null}
      </div>
      {mode.kind === "form" ? (
        <PlayRecordForm
          strings={strings}
          locale={locale}
          gameId={gameId}
          platforms={state.platforms}
          record={mode.record}
          onCancel={backToList}
          onSaved={(saved, kind) => {
            onRecords(kind === "created" ? [saved, ...records] : records.map((r) => (r.id === saved.id ? saved : r)));
            setMessage({ tone: "ok", text: str(strings, kind === "created" ? "play.created" : "play.updated") });
            setMode({ kind: "list" });
          }}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label={str(strings, "play.listLabel")}>
            {records.map((r) => (
              <li key={r.id} className="rounded-md border border-[var(--border)] p-3">
                <PlayRecordSummary
                  strings={strings}
                  locale={locale}
                  record={r}
                  platforms={state.platforms}
                  onEdit={() => {
                    setMessage(null);
                    setMode({ kind: "form", record: r });
                  }}
                  onDeleted={(id) => onRecords(records.filter((x) => x.id !== id))}
                  onMessage={(text, tone) => setMessage({ tone, text })}
                />
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setMessage(null);
                setMode({ kind: "form", record: null });
              }}
            >
              {str(strings, "play.addAnother")}
            </button>
            <a className="link inline-flex min-h-11 items-center" href={accountPlaysHref(locale)}>
              {str(strings, "play.viewAll")}
            </a>
          </p>
        </>
      )}
    </>
  );
}
