"use client";
/** 詳情頁「加入清單」對話框內容：我的清單（勾選＝在清單內，勾選／取消立即生效）＋就地新增清單。 */
import { useState, type FormEvent, type ReactElement } from "react";
import { LIST_NAME_MAX, type ListVisibility } from "../domain/entities/lists";
import { LIST_VISIBILITIES } from "../domain/entities/providers";
import { addGameToList, createList, removeGameFromList, type MyGameState } from "./data-api";
import { CONTROL_CLASS, Field } from "./form-parts";
import { apiErrorText } from "./play-record-form";
import { fieldErrorText } from "./play-format";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export type GameListRow = MyGameState["lists"][number];

export interface ListPickerProps {
  strings: AccountStrings;
  gameId: number;
  lists: GameListRow[];
  onChange: (lists: GameListRow[]) => void;
  manageHref: string;
}

export function ListPicker({ strings, gameId, lists, onChange, manageHref }: ListPickerProps): ReactElement {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<ListVisibility | "">("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function toggle(row: GameListRow, next: boolean): Promise<void> {
    setBusyId(row.id);
    setMessage(null);
    // 樂觀更新：先反映勾選，失敗再還原
    const apply = (contains: boolean, delta: number) =>
      onChange(lists.map((l) => (l.id === row.id ? { ...l, contains, gameCount: Math.max(0, l.gameCount + delta) } : l)));
    apply(next, next ? 1 : -1);
    const res = next ? await addGameToList(row.id, gameId) : await removeGameFromList(row.id, gameId);
    setBusyId(null);
    if (!res.ok) {
      apply(row.contains, 0);
      setMessage({ tone: "error", text: apiErrorText(strings, res) });
      return;
    }
    setMessage({ tone: "ok", text: str(strings, next ? "list.added" : "list.removed", { name: row.name }) });
  }

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    setNameError(null);
    setMessage(null);
    if (name.trim() === "") {
      setNameError(fieldErrorText(strings, "required"));
      return;
    }
    setCreating(true);
    const res = await createList({ name: name.trim(), ...(visibility ? { visibility } : {}) });
    if (!res.ok || !res.data) {
      setCreating(false);
      if (res.code === "validation_failed" && res.fields?.name) setNameError(fieldErrorText(strings, res.fields.name));
      else setMessage({ tone: "error", text: apiErrorText(strings, res) });
      return;
    }
    const created = res.data.list;
    const add = await addGameToList(created.id, gameId);
    setCreating(false);
    const row: GameListRow = { id: created.id, name: created.name, visibility: created.visibility, gameCount: add.ok ? 1 : 0, contains: add.ok, note: null };
    onChange([...lists, row]);
    setName("");
    setMessage(add.ok ? { tone: "ok", text: str(strings, "list.createdAndAdded", { name: created.name }) } : { tone: "error", text: apiErrorText(strings, add) });
  }

  return (
    <>
      <p className="text-sm text-[var(--muted)]">{str(strings, "list.pickerHint")}</p>
      <div role="status" aria-live="polite" className="min-h-6">
        {message ? <p className={message.tone === "error" ? "text-[var(--danger)]" : ""}>{message.text}</p> : null}
      </div>
      {lists.length === 0 ? (
        <p>{str(strings, "list.pickerEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={str(strings, "list.pickerLabel")}>
          {lists.map((l) => (
            <li key={l.id} className="rounded-md border border-[var(--border)] px-3">
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="size-5 shrink-0" checked={l.contains} disabled={busyId !== null} onChange={(e) => void toggle(l, e.target.checked)} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.name}</span>
                <span className="shrink-0 text-sm text-[var(--muted)]">{str(strings, `list.visibility.${l.visibility}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-col gap-3 border-t border-[var(--border)] pt-3" noValidate onSubmit={(e) => void onCreate(e)}>
        <h3 className="font-bold">{str(strings, "list.newTitle")}</h3>
        <Field id="picker-new-name" label={str(strings, "list.field.name")} error={nameError}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="text" maxLength={LIST_NAME_MAX} className={CONTROL_CLASS} value={name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field id="picker-new-visibility" label={str(strings, "list.field.visibility")}>
          {({ id, describedBy }) => (
            <select id={id} className={CONTROL_CLASS} aria-describedby={describedBy} value={visibility} onChange={(e) => setVisibility(e.target.value as ListVisibility | "")}>
              <option value="">{str(strings, "list.visibility.default")}</option>
              {LIST_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {str(strings, `list.visibility.${v}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? str(strings, "list.creating") : str(strings, "list.createAndAdd")}
          </button>
        </p>
      </form>
      <p>
        <a className="link inline-flex min-h-11 items-center" href={manageHref}>
          {str(strings, "list.manage")}
        </a>
      </p>
    </>
  );
}
