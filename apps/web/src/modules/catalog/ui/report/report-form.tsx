"use client";
/**
 * 資料更正回報表單（客戶端元件；12 §入口）。送出 POST /api/v1/reports（JSON），顯示成功／欄位錯誤／限額等訊息。
 * 驗證規則的唯一實作在伺服器（domain/report-validation.ts）：這裡不重複，只把伺服器回的欄位錯誤對應到欄位。
 * Turnstile widget 在有 siteKey 時才載入（腳本由 Cloudflare 提供，載入失敗時送出會得到「請先完成人機驗證」）。
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";

export interface Option {
  value: string;
  label: string;
}

export interface ReportFormStrings {
  fieldType: string;
  fieldPlatform: string;
  fieldRegion: string;
  fieldDate: string;
  fieldPrecision: string;
  fieldStage: string;
  fieldLanguage: string;
  fieldSupportType: string;
  fieldSourceUrl: string;
  fieldNote: string;
  fieldCaptcha: string;
  hintSourceUrl: string;
  hintSourceUrlRequired: string;
  hintDate: string;
  hintTakedown: string;
  hintNote: string;
  choose: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  backTo: string;
  errorSummary: string;
  errorRequired: string;
  errorInvalid: string;
  errorTooLong: string;
  errorRateLimited: string;
  errorCaptchaFailed: string;
  errorCaptchaMissing: string;
  errorUnavailable: string;
  errorNetwork: string;
  errorGeneric: string;
  captchaLoading: string;
  currentValue: string | null;
}

export interface ReportFormProps {
  strings: ReportFormStrings;
  targetType: string;
  targetId: number;
  /** 目標公開頁（含語系前綴），成功後的「回到…」連結。 */
  backHref: string;
  initialType: string;
  reportTypes: Option[];
  platforms: Option[];
  regions: Option[];
  precisions: Option[];
  stages: Option[];
  languages: Option[];
  supportTypes: Option[];
  noteMax: number;
  siteKey: string | null;
  /** Turnstile widget 的語言代碼（zh-tw、en、ja）。 */
  captchaLanguage: string;
}

interface TurnstileApi {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void; language?: string }): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DATE_TYPES = ["wrong_date", "missing_region_date"];

type Values = Record<"date" | "precision" | "platformId" | "regionCode" | "stage" | "language" | "supportType" | "sourceUrl" | "note", string>;

interface FieldBoxProps {
  uid: string;
  errors: Record<string, string>;
  toText: (code: string | undefined) => string | null;
  name: string;
  label: string;
  errorKey: string;
  hint?: string;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactElement;
}

/** 一個欄位：label、控制項、說明、錯誤訊息（用 aria-describedby 連結）。模組層級元件，重新渲染時不會重建控制項。 */
function FieldBox({ uid, errors, toText, name, label, errorKey, hint, children }: FieldBoxProps): ReactElement {
  const idBase = `${uid}-${name}`;
  const error = toText(errors[errorKey]);
  const describedBy = [hint ? `${idBase}-hint` : "", error ? `${idBase}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idBase} className="font-semibold">
        {label}
      </label>
      {children({ id: idBase, describedBy, invalid: error !== null })}
      {hint ? (
        <p id={`${idBase}-hint`} className="text-sm text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${idBase}-err`} className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReportForm(props: ReportFormProps): ReactElement {
  const { strings: s, siteKey, captchaLanguage } = props;
  const uid = useId();
  const [type, setType] = useState(props.initialType);
  const [values, setValues] = useState<Values>({
    date: "",
    precision: "day",
    platformId: "",
    regionCode: "",
    stage: "",
    language: "",
    supportType: "",
    sourceUrl: "",
    note: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [captchaReady, setCaptchaReady] = useState(siteKey === null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !window.turnstile || !boxRef.current || widgetRef.current !== undefined) return;
      widgetRef.current = window.turnstile.render(boxRef.current, {
        sitekey: siteKey,
        language: captchaLanguage,
        callback: (t) => setToken(t),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
      setCaptchaReady(true);
    };
    if (window.turnstile) mount();
    else {
      let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "";
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      if (widgetRef.current !== undefined) window.turnstile?.remove(widgetRef.current);
      widgetRef.current = undefined;
    };
  }, [siteKey, captchaLanguage]);

  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const errorText = (code: string | undefined): string | null =>
    code === "required" ? s.errorRequired : code === "too_long" ? s.errorTooLong : code ? s.errorInvalid : null;

  function buildBody(): Record<string, unknown> {
    const proposed: Record<string, unknown> = {};
    if (DATE_TYPES.includes(type)) {
      proposed.precision = values.precision;
      if (values.date) proposed.date = values.date;
      if (type === "missing_region_date") {
        if (values.platformId) proposed.platformId = Number(values.platformId);
        if (values.regionCode) proposed.regionCode = values.regionCode;
      }
    } else if (type === "wrong_stage") {
      if (values.stage) proposed.stage = values.stage;
    } else if (type === "language_support") {
      if (values.language) proposed.language = values.language;
      if (values.supportType) proposed.supportType = values.supportType;
    }
    return {
      reportType: type,
      targetType: props.targetType,
      targetId: props.targetId,
      ...(Object.keys(proposed).length > 0 ? { proposed } : {}),
      ...(values.sourceUrl ? { sourceUrl: values.sourceUrl } : {}),
      ...(values.note ? { note: values.note } : {}),
      ...(token ? { turnstileToken: token } : {}),
    };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFieldErrors({});
    setFormError(null);
    if (siteKey && !token) {
      setFormError(s.errorCaptchaMissing);
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (res.status === 201) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      if (res.status === 400 && data.fields) {
        setFieldErrors(data.fields);
        setFormError(s.errorSummary);
      } else if (res.status === 429) setFormError(s.errorRateLimited);
      else if (res.status === 403) setFormError(s.errorCaptchaFailed);
      else if (res.status === 503) setFormError(s.errorUnavailable);
      else setFormError(s.errorGeneric);
      // Turnstile token 只能用一次：失敗後換一個新的
      if (siteKey && widgetRef.current !== undefined) {
        window.turnstile?.reset(widgetRef.current);
        setToken(null);
      }
      queueMicrotask(() => summaryRef.current?.focus());
    } catch {
      setFormError(s.errorNetwork);
      queueMicrotask(() => summaryRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="notice flex flex-col gap-2" data-report-success="">
        <h2 className="text-xl font-semibold">{s.successTitle}</h2>
        <p>{s.successBody}</p>
        <p>
          <a className="link inline-flex min-h-11 items-center" href={props.backHref}>
            {s.backTo}
          </a>
        </p>
      </div>
    );
  }

  const fid = (name: string) => `${uid}-${name}`;
  const box = { uid, errors: fieldErrors, toText: errorText };
  const control = "min-h-8 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] px-2";
  const isDate = DATE_TYPES.includes(type);

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-4" data-report-form="">
      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {formError ? (
          <p role="alert" className="notice" data-report-error="">
            {formError}
          </p>
        ) : null}
      </div>

      {s.currentValue ? <p className="text-sm text-[var(--muted)]">{s.currentValue}</p> : null}

      <FieldBox {...box} name="type" label={s.fieldType} errorKey="reportType">
        {({ id, describedBy, invalid }) => (
          <select id={id} className={control} value={type} onChange={(e) => setType(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid}>
            {props.reportTypes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </FieldBox>

      {type === "missing_region_date" ? (
        <>
          <FieldBox {...box} name="platform" label={s.fieldPlatform} errorKey="proposed.platformId">
            {({ id, describedBy, invalid }) => (
              <select id={id} className={control} value={values.platformId} onChange={set("platformId")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true">
                <option value="">{s.choose}</option>
                {props.platforms.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FieldBox>
          <FieldBox {...box} name="region" label={s.fieldRegion} errorKey="proposed.regionCode">
            {({ id, describedBy, invalid }) => (
              <select id={id} className={control} value={values.regionCode} onChange={set("regionCode")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true">
                <option value="">{s.choose}</option>
                {props.regions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FieldBox>
        </>
      ) : null}

      {isDate ? (
        <>
          <FieldBox {...box} name="precision" label={s.fieldPrecision} errorKey="proposed.precision">
            {({ id, describedBy, invalid }) => (
              <select id={id} className={control} value={values.precision} onChange={set("precision")} aria-describedby={describedBy} aria-invalid={invalid}>
                {props.precisions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FieldBox>
          {values.precision !== "tbd" ? (
            <FieldBox {...box} name="date" label={s.fieldDate} errorKey="proposed.date" hint={s.hintDate}>
              {({ id, describedBy, invalid }) => (
                <input id={id} type="date" className={control} value={values.date} onChange={set("date")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true" />
              )}
            </FieldBox>
          ) : null}
        </>
      ) : null}

      {type === "wrong_stage" ? (
        <FieldBox {...box} name="stage" label={s.fieldStage} errorKey="proposed.stage">
          {({ id, describedBy, invalid }) => (
            <select id={id} className={control} value={values.stage} onChange={set("stage")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true">
              <option value="">{s.choose}</option>
              {props.stages.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </FieldBox>
      ) : null}

      {type === "language_support" ? (
        <>
          <FieldBox {...box} name="language" label={s.fieldLanguage} errorKey="proposed.language">
            {({ id, describedBy, invalid }) => (
              <select id={id} className={control} value={values.language} onChange={set("language")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true">
                <option value="">{s.choose}</option>
                {props.languages.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FieldBox>
          <FieldBox {...box} name="supportType" label={s.fieldSupportType} errorKey="proposed.supportType">
            {({ id, describedBy, invalid }) => (
              <select id={id} className={control} value={values.supportType} onChange={set("supportType")} aria-describedby={describedBy} aria-invalid={invalid} aria-required="true">
                <option value="">{s.choose}</option>
                {props.supportTypes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FieldBox>
        </>
      ) : null}

      <FieldBox {...box} name="sourceUrl" label={s.fieldSourceUrl} errorKey="sourceUrl" hint={isDate ? `${s.hintSourceUrlRequired} ${s.hintSourceUrl}` : s.hintSourceUrl}>
        {({ id, describedBy, invalid }) => (
          <input id={id} type="url" inputMode="url" autoComplete="off" className={control} value={values.sourceUrl} onChange={set("sourceUrl")} aria-describedby={describedBy} aria-invalid={invalid} aria-required={isDate ? "true" : undefined} />
        )}
      </FieldBox>

      <FieldBox {...box} name="note" label={s.fieldNote} errorKey="note" hint={type === "takedown" ? `${s.hintTakedown} ${s.hintNote}` : s.hintNote}>
        {({ id, describedBy, invalid }) => (
          <textarea id={id} rows={4} maxLength={props.noteMax} className={`${control} py-2`} value={values.note} onChange={set("note")} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </FieldBox>

      {siteKey ? (
        <div className="flex flex-col gap-1">
          <span className="font-semibold" id={fid("captcha")}>
            {s.fieldCaptcha}
          </span>
          <div ref={boxRef} role="group" aria-labelledby={fid("captcha")} />
          {!captchaReady ? <p className="text-sm text-[var(--muted)]">{s.captchaLoading}</p> : null}
        </div>
      ) : null}

      <div>
        <button type="submit" className="btn-primary" disabled={submitting} aria-disabled={submitting}>
          {submitting ? s.submitting : s.submit}
        </button>
      </div>
    </form>
  );
}
