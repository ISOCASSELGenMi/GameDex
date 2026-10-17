"use client";
/** `/[locale]/account/lists`：我的清單（建立、改名、改描述、改可見度、刪除需確認、上下移動排序、unlisted 的分享網址）。 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { LIST_DESCRIPTION_MAX, LIST_NAME_MAX, type ListSummaryView, type ListVisibility } from "../domain/entities/lists";
import { LIST_VISIBILITIES } from "../domain/entities/providers";
import { ConfirmButton } from "./confirm-button";
import { copyText } from "./clipboard";
import { createList, deleteList, getMyLists, patchList, reorderLists, type MyListsResponse } from "./data-api";
import { CONTROL_CLASS, Field } from "./form-parts";
import { accountListHref, publicListHref } from "./links";
import { fieldErrorText } from "./play-format";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

type Notice = { tone: "ok" | "error"; text: string } | null;

export function AccountLists({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <ListsBody strings={strings} locale={locale} />
    </RequireUser>
  );
}

function ListsBody({ strings, locale }: { strings: AccountStrings; locale: string }): ReactElement {
  const [data, setData] = useState<MyListsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getMyLists();
      if (!alive) return;
      if (res.ok && res.data) setData(res.data);
      else setLoadError(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loadError) return <p role="alert" className="text-[var(--danger)]">{str(strings, "list.error.load")}</p>;
  if (!data) return <p aria-live="polite">{str(strings, "common.loading")}</p>;

  const lists = data.items;
  const replace = (next: ListSummaryView[]) => setData({ ...data, items: next });

  async function move(index: number, delta: -1 | 1): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= lists.length) return;
    const order = lists.map((l) => l.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    const res = await reorderLists(order);
    if (res.ok && res.data) {
      replace(res.data.items);
      setNotice({ tone: "ok", text: str(strings, "list.moved", { name: lists[index]!.name, position: String(target + 1) }) });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  async function remove(list: ListSummaryView): Promise<void> {
    const res = await deleteList(list.id);
    if (res.ok) {
      replace(lists.filter((l) => l.id !== list.id));
      setNotice({ tone: "ok", text: str(strings, "list.deleted", { name: list.name }) });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-[var(--muted)]">{str(strings, "list.pageHint")}</p>
      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
      <CreateListForm
        strings={strings}
        disabled={lists.length >= data.limits.maxLists}
        onCreated={(list) => {
          replace([...lists, list]);
          setNotice({ tone: "ok", text: str(strings, "list.created", { name: list.name }) });
        }}
        onError={(text) => setNotice({ tone: "error", text })}
      />
      {lists.length === 0 ? (
        <p className="text-[var(--muted)]">{str(strings, "list.empty")}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3" aria-label={str(strings, "list.listLabel")}>
          {lists.map((l, i) => (
            <li key={l.id} className="relative flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-3" data-list-id={l.id}>
              {editingId === l.id ? (
                <EditListForm
                  strings={strings}
                  list={l}
                  onSaved={(saved) => {
                    replace(lists.map((x) => (x.id === saved.id ? saved : x)));
                    setEditingId(null);
                    setNotice({ tone: "ok", text: str(strings, "list.saved", { name: saved.name }) });
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="min-w-0 text-lg font-bold [overflow-wrap:anywhere]">
                      <a className="link" href={accountListHref(locale, l.id)}>
                        {l.name}
                      </a>
                    </h2>
                    <p className="text-sm text-[var(--muted)]">
                      {str(strings, `list.visibility.${l.visibility}`)} ・ {str(strings, "list.gameCount", { count: String(l.gameCount) })}
                    </p>
                  </div>
                  {l.description ? <p className="text-sm [overflow-wrap:anywhere]">{l.description}</p> : null}
                  {l.visibility !== "private" ? <ShareInfo strings={strings} locale={locale} list={l} onChanged={(saved) => replace(lists.map((x) => (x.id === saved.id ? saved : x)))} onNotice={setNotice} /> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setEditingId(l.id)}>
                      {str(strings, "list.edit")}
                      <span className="sr-only"> {l.name}</span>
                    </button>
                    <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => void move(i, -1)}>
                      {str(strings, "list.moveUp")}
                      <span className="sr-only"> {l.name}</span>
                    </button>
                    <button type="button" className="btn-secondary" disabled={i === lists.length - 1} onClick={() => void move(i, 1)}>
                      {str(strings, "list.moveDown")}
                      <span className="sr-only"> {l.name}</span>
                    </button>
                    <ConfirmButton strings={strings} label={str(strings, "list.delete")} srContext={l.name} confirmText={str(strings, "list.confirmDelete", { name: l.name })} onConfirm={() => remove(l)} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VisibilitySelect({ strings, id, value, onChange, withDefault, describedBy }: { strings: AccountStrings; id: string; value: ListVisibility | ""; onChange: (v: ListVisibility | "") => void; withDefault?: boolean; describedBy?: string }): ReactElement {
  return (
    <select id={id} className={CONTROL_CLASS} value={value} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value as ListVisibility | "")}>
      {withDefault ? <option value="">{str(strings, "list.visibility.default")}</option> : null}
      {LIST_VISIBILITIES.map((v) => (
        <option key={v} value={v}>
          {str(strings, `list.visibility.${v}`)}
        </option>
      ))}
    </select>
  );
}

function CreateListForm({ strings, disabled, onCreated, onError }: { strings: AccountStrings; disabled: boolean; onCreated: (l: ListSummaryView) => void; onError: (text: string) => void }): ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ListVisibility | "">("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim() === "") {
      setErrors({ name: fieldErrorText(strings, "required") });
      return;
    }
    setBusy(true);
    setErrors({});
    const res = await createList({ name: name.trim(), description: description.trim() || null, ...(visibility ? { visibility } : {}) });
    setBusy(false);
    if (res.ok && res.data) {
      onCreated(res.data.list);
      setName("");
      setDescription("");
      return;
    }
    if (res.code === "validation_failed" && res.fields) setErrors(Object.fromEntries(Object.entries(res.fields).map(([k, c]) => [k, fieldErrorText(strings, c)])));
    else onError(apiErrorText(strings, res));
  }

  return (
    <form className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border)] p-3" noValidate onSubmit={(e) => void submit(e)} aria-labelledby="new-list-heading">
      <h2 id="new-list-heading" className="text-lg font-bold">
        {str(strings, "list.newTitle")}
      </h2>
      <Field id="new-list-name" label={str(strings, "list.field.name")} error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <input id={id} type="text" maxLength={LIST_NAME_MAX} className={CONTROL_CLASS} value={name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field id="new-list-description" label={str(strings, "list.field.description")} error={errors.description}>
        {({ id, describedBy, invalid }) => (
          <textarea id={id} rows={2} maxLength={LIST_DESCRIPTION_MAX} className={`${CONTROL_CLASS} py-2`} value={description} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <Field id="new-list-visibility" label={str(strings, "list.field.visibility")} hint={str(strings, "list.visibilityHint")} error={errors.visibility}>
        {({ id, describedBy }) => <VisibilitySelect strings={strings} id={id} value={visibility} onChange={setVisibility} withDefault describedBy={describedBy} />}
      </Field>
      <p>
        <button type="submit" className="btn-primary" disabled={busy || disabled}>
          {busy ? str(strings, "list.creating") : str(strings, "list.create")}
        </button>
      </p>
    </form>
  );
}

function EditListForm({ strings, list, onSaved, onCancel }: { strings: AccountStrings; list: ListSummaryView; onSaved: (l: ListSummaryView) => void; onCancel: () => void }): ReactElement {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? "");
  const [visibility, setVisibility] = useState<ListVisibility>(list.visibility);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim() === "") {
      setErrors({ name: fieldErrorText(strings, "required") });
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    const res = await patchList(list.id, { name: name.trim(), description: description.trim() || null, visibility });
    setBusy(false);
    if (res.ok && res.data) {
      onSaved(res.data.list);
      return;
    }
    if (res.code === "validation_failed" && res.fields) setErrors(Object.fromEntries(Object.entries(res.fields).map(([k, c]) => [k, fieldErrorText(strings, c)])));
    else setFormError(apiErrorText(strings, res));
  }

  const idp = `edit-list-${list.id}`;
  return (
    <form className="flex min-w-0 flex-col gap-3" noValidate onSubmit={(e) => void submit(e)}>
      {formError ? (
        <p role="alert" className="notice text-[var(--danger)]">
          {formError}
        </p>
      ) : null}
      <Field id={`${idp}-name`} label={str(strings, "list.field.name")} error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <input ref={ref} id={id} type="text" maxLength={LIST_NAME_MAX} className={CONTROL_CLASS} value={name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field id={`${idp}-description`} label={str(strings, "list.field.description")} error={errors.description}>
        {({ id, describedBy, invalid }) => (
          <textarea id={id} rows={2} maxLength={LIST_DESCRIPTION_MAX} className={`${CONTROL_CLASS} py-2`} value={description} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <Field id={`${idp}-visibility`} label={str(strings, "list.field.visibility")} hint={str(strings, "list.visibilityHint")} error={errors.visibility}>
        {({ id, describedBy }) => <VisibilitySelect strings={strings} id={id} value={visibility} onChange={(v) => v && setVisibility(v)} describedBy={describedBy} />}
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

/** 公開／不公開清單的網址區：public＝公開頁連結；unlisted＝分享網址＋複製＋重新產生（舊網址立即失效）。 */
function ShareInfo({ strings, locale, list, onChanged, onNotice }: { strings: AccountStrings; locale: string; list: ListSummaryView; onChanged: (l: ListSummaryView) => void; onNotice: (n: Notice) => void }): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const href = publicListHref(locale, list);
  const full = typeof window === "undefined" ? href : `${window.location.origin}${href}`;

  async function copy(): Promise<void> {
    if (await copyText(full)) onNotice({ tone: "ok", text: str(strings, "list.copied") });
    else {
      // 沒有剪貼簿權限：選取文字讓使用者自己複製
      inputRef.current?.select();
      onNotice({ tone: "error", text: str(strings, "list.copyFailed") });
    }
  }

  async function rotate(): Promise<void> {
    const res = await patchList(list.id, { rotateShareToken: true });
    if (res.ok && res.data) {
      onChanged(res.data.list);
      onNotice({ tone: "ok", text: str(strings, "list.rotated", { name: list.name }) });
    } else onNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  if (list.visibility === "public") {
    return (
      <p className="text-sm">
        <a className="link" href={href}>
          {str(strings, "list.viewPublic")}
          <span className="sr-only"> {list.name}</span>
        </a>
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md bg-[var(--surface)] p-2">
      <label htmlFor={`share-${list.id}`} className="text-sm font-semibold">
        {str(strings, "list.shareUrl")}
      </label>
      <input id={`share-${list.id}`} ref={inputRef} readOnly className={CONTROL_CLASS} value={full} onFocus={(e) => e.currentTarget.select()} />
      <p className="text-sm text-[var(--muted)]">{str(strings, "list.shareHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => void copy()}>
          {str(strings, "list.copy")}
          <span className="sr-only"> {list.name}</span>
        </button>
        <ConfirmButton strings={strings} label={str(strings, "list.rotate")} srContext={list.name} confirmText={str(strings, "list.confirmRotate")} confirmLabel={str(strings, "list.confirmRotateButton")} onConfirm={rotate} />
      </div>
    </div>
  );
}
