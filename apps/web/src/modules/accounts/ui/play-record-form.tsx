"use client";
/**
 * 遊玩紀錄表單與單筆摘要（詳情頁對話框與 /account/plays 共用；只實作一次）。
 * - PlayRecordForm：建立（record=null）或編輯（PATCH 送出全部欄位，空值以 null 清除）。
 * - PlayRecordSummary：一筆紀錄的摘要＋編輯／刪除（刪除需行內確認）。
 */
import { useRef, useState, type FormEvent, type ReactElement } from "react";
import type { GamePlatformOption } from "@/modules/catalog";
import { PLAY_STATUSES, REVIEW_MAX, PRIVATE_NOTE_MAX, type PlayRecordView, type PlayStatus, type ReviewVisibility } from "../domain/entities/play-records";
import { REVIEW_VISIBILITIES } from "../domain/entities/providers";
import { createPlayRecord, deletePlayRecord, patchPlayRecord, type PlayRecordInput } from "./data-api";
import { ConfirmButton } from "./confirm-button";
import { CONTROL_CLASS, Field, FormError } from "./form-parts";
import { fieldErrorText, formatPlayTime, formatRating, joinMinutes, playStatusLabel, ratingOptions, splitMinutes } from "./play-format";
import { str } from "./str";
import type { AccountStrings } from "./strings";
import type { ApiResult } from "./auth-api";

/** API 失敗 → 表單層級的訊息（欄位錯誤另行顯示）。 */
export function apiErrorText(strings: AccountStrings, res: ApiResult<unknown>): string {
  if (res.network) return str(strings, "common.network");
  switch (res.code) {
    case "play_record_limit_reached":
      return str(strings, "error.playRecordLimit");
    case "list_limit_reached":
      return str(strings, "error.listLimit");
    case "list_games_limit_reached":
      return str(strings, "error.listGamesLimit");
    case "game_not_found":
      return str(strings, "error.gameNotFound");
    case "list_not_found":
    case "record_not_found":
    case "not_in_list":
    case "feed_not_found":
      return str(strings, "error.notFound");
    case "follow_limit_reached":
      return str(strings, "error.followLimit");
    case "target_not_found":
      return str(strings, "error.followNotFound");
    case "unauthorized":
      return str(strings, "error.unauthorized");
    case "invalid_origin":
      return str(strings, "account.error.notFresh");
    default:
      return res.status === 429 ? str(strings, "common.rateLimited") : str(strings, "common.generic");
  }
}

const FIELD_ORDER = ["status", "platformId", "startedOn", "finishedOn", "playMinutes", "ratingHalfSteps", "review", "reviewVisibility", "privateNote"] as const;
type FieldName = (typeof FIELD_ORDER)[number];

export interface PlayRecordFormProps {
  strings: AccountStrings;
  locale: string;
  gameId: number;
  platforms: readonly GamePlatformOption[];
  /** null＝新增。 */
  record: PlayRecordView | null;
  /** 新增時的預設狀態。 */
  defaultStatus?: PlayStatus;
  onSaved: (record: PlayRecordView, mode: "created" | "updated") => void;
  onCancel: () => void;
}

export function PlayRecordForm({ strings, locale, gameId, platforms, record, defaultStatus = "playing", onSaved, onCancel }: PlayRecordFormProps): ReactElement {
  const formRef = useRef<HTMLFormElement>(null);
  const initialTime = record?.playMinutes != null ? splitMinutes(record.playMinutes) : null;
  const [status, setStatus] = useState<PlayStatus>(record?.status ?? defaultStatus);
  const [platformId, setPlatformId] = useState(record?.platformId != null ? String(record.platformId) : "");
  const [startedOn, setStartedOn] = useState(record?.startedOn ?? "");
  const [finishedOn, setFinishedOn] = useState(record?.finishedOn ?? "");
  const [hours, setHours] = useState(initialTime ? String(initialTime.hours) : "");
  const [minutes, setMinutes] = useState(initialTime ? String(initialTime.minutes) : "");
  const [rating, setRating] = useState(record?.ratingHalfSteps != null ? String(record.ratingHalfSteps) : "");
  const [review, setReview] = useState(record?.review ?? "");
  const [spoilers, setSpoilers] = useState(record?.reviewHasSpoilers ?? false);
  const [visibility, setVisibility] = useState<ReviewVisibility | "">(record?.reviewVisibility ?? "");
  const [privateNote, setPrivateNote] = useState(record?.privateNote ?? "");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idBase = `pr-${record?.id ?? "new"}`;
  const fid = (name: string) => `${idBase}-${name}`;
  const platformOptions: { id: number; label: string }[] = platforms.map((p) => ({ id: p.id, label: p.abbreviation ?? p.name }));
  // 紀錄上的平台不在選項內（例如 mobile）：保留該值，避免編輯時被清掉
  if (record?.platformId != null && !platformOptions.some((p) => p.id === record.platformId)) platformOptions.push({ id: record.platformId, label: str(strings, "play.platformOther") });

  function focusFirstError(errs: Partial<Record<FieldName, string>>): void {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(fid(first === "playMinutes" ? "hours" : first))}`)?.focus();
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const errs: Partial<Record<FieldName, string>> = {};
    const time = joinMinutes(hours, minutes);
    if (!time.ok) errs.playMinutes = fieldErrorText(strings, time.code);
    if (startedOn && finishedOn && finishedOn < startedOn) errs.finishedOn = fieldErrorText(strings, "before_started_on");
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setFormError(str(strings, "error.summary"));
      focusFirstError(errs);
      return;
    }
    const body: PlayRecordInput = {
      status,
      platformId: platformId ? Number(platformId) : null,
      startedOn: startedOn || null,
      finishedOn: finishedOn || null,
      playMinutes: time.ok ? time.minutes : null,
      ratingHalfSteps: rating ? Number(rating) : null,
      review: review.trim() === "" ? null : review,
      reviewHasSpoilers: spoilers,
      ...(visibility ? { reviewVisibility: visibility } : {}),
      privateNote: privateNote.trim() === "" ? null : privateNote,
    };
    setBusy(true);
    setErrors({});
    setFormError(null);
    const res = record ? await patchPlayRecord(record.id, body) : await createPlayRecord(gameId, body);
    setBusy(false);
    if (res.ok && res.data) {
      onSaved(res.data.record, record ? "updated" : "created");
      return;
    }
    if (res.code === "validation_failed" && res.fields) {
      const mapped: Partial<Record<FieldName, string>> = {};
      for (const [field, code] of Object.entries(res.fields)) {
        const name = (FIELD_ORDER as readonly string[]).includes(field) ? (field as FieldName) : "status";
        mapped[name] = fieldErrorText(strings, code);
      }
      setErrors(mapped);
      setFormError(str(strings, "error.summary"));
      focusFirstError(mapped);
      return;
    }
    setFormError(apiErrorText(strings, res));
  }

  return (
    <form ref={formRef} className="flex min-w-0 flex-col gap-3" noValidate onSubmit={(e) => void onSubmit(e)}>
      <FormError>{formError}</FormError>
      <Field id={fid("status")} label={str(strings, "play.field.status")} error={errors.status}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={status} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setStatus(e.target.value as PlayStatus)}>
            {PLAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {playStatusLabel(strings, s)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={fid("platformId")} label={str(strings, "play.field.platform")} error={errors.platformId}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={platformId} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setPlatformId(e.target.value)}>
            <option value="">{str(strings, "play.platformNone")}</option>
            {platformOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={fid("startedOn")} label={str(strings, "play.field.startedOn")} error={errors.startedOn}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="date" className={CONTROL_CLASS} value={startedOn} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setStartedOn(e.target.value)} />
          )}
        </Field>
        <Field id={fid("finishedOn")} label={str(strings, "play.field.finishedOn")} error={errors.finishedOn}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="date" className={CONTROL_CLASS} value={finishedOn} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setFinishedOn(e.target.value)} />
          )}
        </Field>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-1" aria-describedby={errors.playMinutes ? fid("time-err") : undefined}>
        <legend className="font-semibold">{str(strings, "play.field.time")}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              id={fid("hours")}
              type="text"
              inputMode="numeric"
              className={`${CONTROL_CLASS} !w-24`}
              value={hours}
              aria-invalid={errors.playMinutes ? true : undefined}
              onChange={(e) => setHours(e.target.value)}
            />
            <span>{str(strings, "play.field.hours")}</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              id={fid("minutes")}
              type="text"
              inputMode="numeric"
              className={`${CONTROL_CLASS} !w-24`}
              value={minutes}
              aria-invalid={errors.playMinutes ? true : undefined}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <span>{str(strings, "play.field.minutes")}</span>
          </label>
        </div>
        {errors.playMinutes ? (
          <p id={fid("time-err")} className="text-sm text-[var(--danger)]">
            {errors.playMinutes}
          </p>
        ) : null}
      </fieldset>
      <Field id={fid("ratingHalfSteps")} label={str(strings, "play.field.rating")} hint={str(strings, "play.ratingHint")} error={errors.ratingHalfSteps}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={rating} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setRating(e.target.value)}>
            <option value="">{str(strings, "play.ratingNone")}</option>
            {ratingOptions(locale).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={fid("review")} label={str(strings, "play.field.review")} hint={str(strings, "play.reviewHint", { limit: String(REVIEW_MAX) })} error={errors.review}>
        {({ id, describedBy, invalid }) => (
          <textarea id={id} rows={4} className={`${CONTROL_CLASS} py-2`} value={review} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setReview(e.target.value)} />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="size-5" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} />
        <span>{str(strings, "play.field.spoilers")}</span>
      </label>
      <Field id={fid("reviewVisibility")} label={str(strings, "play.field.reviewVisibility")} hint={str(strings, "play.reviewVisibilityHint")} error={errors.reviewVisibility}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={visibility} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setVisibility(e.target.value as ReviewVisibility | "")}>
            {record ? null : <option value="">{str(strings, "play.visibility.default")}</option>}
            {REVIEW_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {str(strings, `play.visibility.${v}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field id={fid("privateNote")} label={str(strings, "play.field.privateNote")} hint={str(strings, "play.privateNoteHint", { limit: String(PRIVATE_NOTE_MAX) })} error={errors.privateNote}>
        {({ id, describedBy, invalid }) => (
          <textarea id={id} rows={3} className={`${CONTROL_CLASS} py-2`} value={privateNote} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setPrivateNote(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? str(strings, "play.saving") : str(strings, "play.save")}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          {str(strings, "common.cancel")}
        </button>
      </div>
    </form>
  );
}

export interface PlayRecordSummaryProps {
  strings: AccountStrings;
  locale: string;
  record: PlayRecordView;
  platforms: readonly GamePlatformOption[];
  onEdit: () => void;
  onDeleted: (id: number) => void;
  /** 回報結果（aria-live 區）。 */
  onMessage: (text: string, tone: "ok" | "error") => void;
}

/** 一筆紀錄的摘要＋編輯／刪除（行內確認）。 */
export function PlayRecordSummary({ strings, locale, record, platforms, onEdit, onDeleted, onMessage }: PlayRecordSummaryProps): ReactElement {
  const platform = record.platformId != null ? platforms.find((p) => p.id === record.platformId) : undefined;
  const parts = [
    platform ? (platform.abbreviation ?? platform.name) : null,
    record.startedOn || record.finishedOn ? `${record.startedOn ?? "…"} – ${record.finishedOn ?? "…"}` : null,
    record.playMinutes != null ? formatPlayTime(strings, record.playMinutes) : null,
    record.ratingHalfSteps != null ? str(strings, "play.ratingValue", { rating: formatRating(record.ratingHalfSteps, locale) }) : null,
  ].filter((x): x is string => !!x);
  const statusText = playStatusLabel(strings, record.status);

  async function onDelete(): Promise<void> {
    const res = await deletePlayRecord(record.id);
    if (res.ok) {
      onMessage(str(strings, "play.deleted"), "ok");
      onDeleted(record.id);
    } else onMessage(apiErrorText(strings, res), "error");
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="font-semibold">{statusText}</p>
      {parts.length > 0 ? <p className="text-sm text-[var(--muted)] [overflow-wrap:anywhere]">{parts.join(" ・ ")}</p> : null}
      {record.review ? <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{record.reviewHasSpoilers ? str(strings, "play.spoilerTag") : record.review}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={onEdit}>
          {str(strings, "play.edit")}
          <span className="sr-only"> {statusText}</span>
        </button>
        <ConfirmButton strings={strings} label={str(strings, "play.delete")} srContext={statusText} confirmText={str(strings, "play.confirmDelete")} onConfirm={onDelete} />
      </div>
    </div>
  );
}
