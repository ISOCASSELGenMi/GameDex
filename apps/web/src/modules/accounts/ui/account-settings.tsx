"use client";
/**
 * `/[locale]/account/settings`：偏好設定（07 §GET|PATCH /account/preferences）。
 * 顯示名稱、語言、時區、地區、評分來源、常用平台，以及新清單與評論的預設可見度（第 5 波待決「沒有設定頁」）。
 * 送出整份目前的值（PATCH 是冪等的；沒有變更伺服器回 changed:false）。
 */
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { DISPLAY_NAME_MAX, PREFERRED_PLATFORMS_MAX, type AccountPreferences } from "../domain/entities/account-self";
import { LIST_VISIBILITIES, REVIEW_VISIBILITIES } from "../domain/entities/providers";
import { getPreferences, patchPreferences } from "./account-self-api";
import { FormError, CONTROL_CLASS, Field } from "./form-parts";
import { accountPageHref, accountPrivacyHref } from "./links";
import { PlatformPicker, type PlatformGroup } from "./platform-picker";
import { fieldErrorText } from "./play-format";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import { useHydrated } from "./use-hydrated";
import type { AccountStrings } from "./strings";

const LOCALES = ["zh-Hant", "en", "ja"] as const;

export interface RegionOption {
  code: string;
  name: string;
}

export interface AccountSettingsProps {
  strings: AccountStrings;
  locale: string;
  platformGroups: PlatformGroup[];
  regions: RegionOption[];
  /** 可選的評分來源（catalog 的 KNOWN_RATING_PROVIDERS，由薄路由傳入）。 */
  scoreProviders: string[];
}

export function AccountSettings(props: AccountSettingsProps): ReactElement {
  return (
    <RequireUser strings={props.strings} locale={props.locale}>
      <SettingsBody {...props} />
    </RequireUser>
  );
}

type Notice = { tone: "ok" | "error"; text: string } | null;

function SettingsBody({ strings, locale, platformGroups, regions, scoreProviders }: AccountSettingsProps): ReactElement {
  const [prefs, setPrefs] = useState<AccountPreferences | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getPreferences();
      if (!alive) return;
      if (res.ok && res.data) {
        setPrefs(res.data.preferences);
        setLoadState("ready");
      } else setLoadState("error");
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loadState === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (loadState === "error" || !prefs) {
    return (
      <p role="alert" className="text-[var(--danger)]">
        {str(strings, "settings.loadError")}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p>{str(strings, "settings.intro")}</p>
      <SettingsForm strings={strings} initial={prefs} platformGroups={platformGroups} regions={regions} scoreProviders={scoreProviders} />
      <p className="flex flex-wrap gap-x-6">
        <a className="link inline-flex min-h-11 items-center" href={accountPrivacyHref(locale)}>
          {str(strings, "settings.toPrivacy")}
        </a>
        <a className="link inline-flex min-h-11 items-center" href={accountPageHref(locale, "account")}>
          {str(strings, "settings.toAccount")}
        </a>
      </p>
    </div>
  );
}

/** 瀏覽器支援的 IANA 時區名稱（只當輸入建議；沒有支援就沒有建議）。 */
function supportedTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

function SettingsForm({
  strings,
  initial,
  platformGroups,
  regions,
  scoreProviders,
}: {
  strings: AccountStrings;
  initial: AccountPreferences;
  platformGroups: PlatformGroup[];
  regions: RegionOption[];
  scoreProviders: string[];
}): ReactElement {
  const uid = useId();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [language, setLanguage] = useState(initial.locale ?? "");
  const [timezone, setTimezone] = useState(initial.timezone ?? "");
  const [region, setRegion] = useState(initial.preferredRegion ?? "");
  const [customScores, setCustomScores] = useState(initial.scoreProviders !== null);
  const [scores, setScores] = useState<Set<string>>(() => new Set(initial.scoreProviders ?? []));
  const [platforms, setPlatforms] = useState<Set<number>>(() => new Set(initial.preferredPlatformIds));
  const [listVisibility, setListVisibility] = useState(initial.defaultListVisibility);
  const [reviewVisibility, setReviewVisibility] = useState(initial.defaultReviewVisibility);
  const hydrated = useHydrated();
  const zones = useMemo(() => (hydrated ? supportedTimeZones() : []), [hydrated]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setNotice(null);
    setErrors({});
    const name = displayName.trim();
    if (name === "") {
      setErrors({ displayName: "required" });
      setNotice({ tone: "error", text: str(strings, "error.summary") });
      return;
    }
    setSaving(true);
    const res = await patchPreferences({
      displayName: name,
      locale: language === "" ? null : language,
      timezone: timezone.trim() === "" ? null : timezone.trim(),
      preferredRegion: region === "" ? null : region,
      scoreProviders: customScores ? [...scores] : null,
      preferredPlatformIds: [...platforms],
      defaultListVisibility: listVisibility,
      defaultReviewVisibility: reviewVisibility,
    });
    setSaving(false);
    if (res.ok && res.data) {
      const p = res.data.preferences;
      setDisplayName(p.displayName);
      setNotice({ tone: "ok", text: str(strings, res.data.changed ? "settings.saved" : "settings.unchanged") });
    } else if (res.fields) {
      setErrors(res.fields);
      setNotice({ tone: "error", text: str(strings, "error.summary") });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  const fieldError = (k: string) => (errors[k] ? fieldErrorText(strings, errors[k]) : null);

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex min-w-0 flex-col gap-5" aria-labelledby={`${uid}-title`} data-section="account-settings">
      <h2 id={`${uid}-title`} className="text-xl font-bold">
        {str(strings, "settings.formTitle")}
      </h2>
      <FormError>{notice?.tone === "error" ? notice.text : null}</FormError>

      <Field id={`${uid}-name`} label={str(strings, "settings.displayName")} hint={str(strings, "settings.displayNameHint")} error={fieldError("displayName")}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className={CONTROL_CLASS} value={displayName} maxLength={DISPLAY_NAME_MAX} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setDisplayName(e.target.value)} />
        )}
      </Field>

      <Field id={`${uid}-locale`} label={str(strings, "settings.locale")} hint={str(strings, "settings.localeHint")} error={fieldError("locale")}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={language} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{str(strings, "settings.localeAuto")}</option>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {str(strings, `feedcal.locale.${l}`)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="flex flex-col gap-1">
        <Field id={`${uid}-tz`} label={str(strings, "settings.timezone")} hint={str(strings, "settings.timezoneHint")} error={fieldError("timezone")}>
          {({ id, describedBy, invalid }) => (
            <>
              <input id={id} className={CONTROL_CLASS} value={timezone} maxLength={64} list={`${uid}-tz-list`} autoComplete="off" spellCheck={false} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setTimezone(e.target.value)} />
              <datalist id={`${uid}-tz-list`}>
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <div>
          <button type="button" className="btn-secondary" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>
            {str(strings, "settings.timezoneUseBrowser")}
          </button>
        </div>
      </div>

      <Field id={`${uid}-region`} label={str(strings, "settings.region")} hint={str(strings, "settings.regionHint")} error={fieldError("preferredRegion")}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={region} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{str(strings, "settings.regionAuto")}</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="font-semibold">{str(strings, "settings.scores")}</legend>
        <p className="text-sm text-[var(--muted)]">{str(strings, "settings.scoresHint")}</p>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="radio" name={`${uid}-scores`} checked={!customScores} onChange={() => setCustomScores(false)} />
          <span>{str(strings, "settings.scoresDefault")}</span>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="radio" name={`${uid}-scores`} checked={customScores} onChange={() => setCustomScores(true)} />
          <span>{str(strings, "settings.scoresCustom")}</span>
        </label>
        {customScores ? (
          <div className="ml-6 flex flex-wrap gap-x-4">
            {scoreProviders.map((p) => (
              <label key={p} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={scores.has(p)}
                  onChange={(e) =>
                    setScores((all) => {
                      const next = new Set(all);
                      if (e.target.checked) next.add(p);
                      else next.delete(p);
                      return next;
                    })
                  }
                />
                <span>{str(strings, `settings.scoreProvider.${p}`)}</span>
              </label>
            ))}
          </div>
        ) : null}
        {customScores && scores.size === 0 ? <p className="ml-6 text-sm text-[var(--muted)]">{str(strings, "settings.scoresNone")}</p> : null}
        {fieldError("scoreProviders") ? <p className="text-sm text-[var(--danger)]">{fieldError("scoreProviders")}</p> : null}
      </fieldset>

      <PlatformPicker
        strings={strings}
        groups={platformGroups}
        selected={platforms}
        onChange={setPlatforms}
        max={PREFERRED_PLATFORMS_MAX}
        legend={str(strings, "settings.platforms")}
        hint={str(strings, "settings.platformsHint")}
        fullText={str(strings, "settings.platformsFull")}
        error={fieldError("preferredPlatformIds")}
      />

      <Field id={`${uid}-listvis`} label={str(strings, "settings.defaultListVisibility")} hint={str(strings, "settings.defaultListVisibilityHint")} error={fieldError("defaultListVisibility")}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={listVisibility} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setListVisibility(e.target.value as typeof listVisibility)}>
            {LIST_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {str(strings, `list.visibility.${v}`)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field id={`${uid}-revvis`} label={str(strings, "settings.defaultReviewVisibility")} hint={str(strings, "settings.defaultReviewVisibilityHint")} error={fieldError("defaultReviewVisibility")}>
        {({ id, describedBy, invalid }) => (
          <select id={id} className={CONTROL_CLASS} value={reviewVisibility} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => setReviewVisibility(e.target.value as typeof reviewVisibility)}>
            {REVIEW_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {str(strings, `play.visibility.${v}`)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div role="status" aria-live="polite" className="min-h-6">
        {notice?.tone === "ok" ? <p>{notice.text}</p> : null}
      </div>
      <div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? str(strings, "settings.saving") : str(strings, "settings.save")}
        </button>
      </div>
    </form>
  );
}
