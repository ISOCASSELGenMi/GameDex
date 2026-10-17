"use client";
/**
 * `/[locale]/account/calendar`：私人 iCal 行事曆（08 §私人 feed、§Token 安全）。
 * 網址等同密碼：預設遮罩（隱藏時 token 不在 DOM 內），按「顯示」才露出；複製、用 App 開啟都不必先顯示。
 * 設定（名稱、語系、包含上市／活動、上市階段、平台）用 PATCH 儲存；「重新產生」需確認並說明舊網址 30 天後失效。
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { FEED_FILTER_MAX, FEED_NAME_MAX, type CalendarFeedView } from "../domain/entities/calendar-feeds";
import { copyText } from "./clipboard";
import { ConfirmButton } from "./confirm-button";
import { getCalendarFeed, patchCalendarFeed, rotateCalendarFeed } from "./follow-api";
import { formatLocalDateTime, maskFeedUrl } from "./follow-format";
import { CONTROL_CLASS, Field } from "./form-parts";
import { accountFollowsHref } from "./links";
import { fieldErrorText } from "./play-format";
import { PlatformPicker, type PlatformGroup } from "./platform-picker";
import { apiErrorText } from "./play-record-form";
import { RequireUser } from "./require-user";
import { str } from "./str";
import type { AccountStrings } from "./strings";

/** 可勾選的上市階段（與 catalog 的 RELEASE_STAGES 一致；字串見 feedcal.stage.*）。 */
const STAGES = ["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"] as const;
const LOCALES = ["zh-Hant", "en", "ja"] as const;

export type { PlatformGroup };

/** 類型選項（slug＋已翻譯的名稱；清單來自 catalog 的篩選選項，薄路由傳入）。 */
export interface GenreChoice {
  slug: string;
  label: string;
}

type Notice = { tone: "ok" | "error"; text: string } | null;

export function AccountCalendar({ strings, locale, platformGroups, genreChoices }: { strings: AccountStrings; locale: string; platformGroups: PlatformGroup[]; genreChoices: GenreChoice[] }): ReactElement {
  return (
    <RequireUser strings={strings} locale={locale}>
      <CalendarBody strings={strings} locale={locale} platformGroups={platformGroups} genreChoices={genreChoices} />
    </RequireUser>
  );
}

function CalendarBody({ strings, locale, platformGroups, genreChoices }: { strings: AccountStrings; locale: string; platformGroups: PlatformGroup[]; genreChoices: GenreChoice[] }): ReactElement {
  const [feed, setFeed] = useState<CalendarFeedView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getCalendarFeed();
      if (!alive) return;
      if (res.ok && res.data) {
        setFeed(res.data.feed);
        setState("ready");
      } else {
        setErrorText(res.status === 429 ? str(strings, "common.rateLimited") : str(strings, "feedcal.loadError"));
        setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [strings]);

  if (state === "loading") return <p aria-live="polite">{str(strings, "common.loading")}</p>;
  if (state === "error" || !feed) {
    return (
      <p role="alert" className="text-[var(--danger)]">
        {errorText}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p>{str(strings, "feedcal.intro")}</p>
      <FeedUrlCard strings={strings} locale={locale} feed={feed} onFeed={setFeed} />
      <SettingsForm strings={strings} feed={feed} platformGroups={platformGroups} genreChoices={genreChoices} onFeed={setFeed} />
      <p className="text-sm">
        <a className="link inline-flex min-h-11 items-center" href={accountFollowsHref(locale)}>
          {str(strings, "account.track.follows")}
        </a>
      </p>
    </div>
  );
}

function FeedUrlCard({ strings, locale, feed, onFeed }: { strings: AccountStrings; locale: string; feed: CalendarFeedView; onFeed: (f: CalendarFeedView) => void }): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlId = useId();
  const url = feed.url;

  async function copy(): Promise<void> {
    if (!url) return;
    if (await copyText(url)) setNotice({ tone: "ok", text: str(strings, "feedcal.copied") });
    else {
      // 沒有剪貼簿權限：露出網址並選取，讓使用者自己複製
      setRevealed(true);
      setNotice({ tone: "error", text: str(strings, "feedcal.copyFailed") });
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }

  async function rotate(): Promise<void> {
    const res = await rotateCalendarFeed(feed.id);
    if (res.ok && res.data) {
      onFeed(res.data.feed);
      setRevealed(false);
      setNotice({ tone: "ok", text: str(strings, "feedcal.rotate.done") });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  return (
    <section aria-labelledby={`${urlId}-title`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" data-section="private-feed-url">
      <h2 id={`${urlId}-title`} className="text-xl font-bold">
        {str(strings, "feedcal.urlLabel")}
      </h2>
      <p className="notice" data-testid="feed-secret-warning">
        {str(strings, "feedcal.secretWarning")}
      </p>
      {url ? (
        revealed ? (
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${urlId}-input`} className="sr-only">
              {str(strings, "feedcal.urlLabel")}
            </label>
            <input id={`${urlId}-input`} ref={inputRef} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${CONTROL_CLASS} text-sm`} data-testid="feed-url" />
          </div>
        ) : (
          <p className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm [overflow-wrap:anywhere]" data-testid="feed-url-masked">
            <span aria-hidden="true">{maskFeedUrl(url)}</span>
            <span className="sr-only">{str(strings, "feedcal.masked")}</span>
          </p>
        )
      ) : (
        <p role="alert" className="text-[var(--danger)]">
          {str(strings, "feedcal.urlUnavailable")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={!url} aria-expanded={revealed} onClick={() => setRevealed((v) => !v)} data-action="toggle-url">
          {str(strings, revealed ? "feedcal.hide" : "feedcal.show")}
        </button>
        <button type="button" className="btn-secondary" disabled={!url} onClick={() => void copy()} data-action="copy-url">
          {str(strings, "feedcal.copy")}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!feed.webcalUrl}
          onClick={() => {
            if (feed.webcalUrl) window.location.assign(feed.webcalUrl);
          }}
          data-action="open-url"
        >
          {str(strings, "feedcal.open")}
        </button>
      </div>
      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
      <p className="text-sm text-[var(--muted)]">{feed.lastAccessedAt ? str(strings, "feedcal.lastAccessed", { date: formatLocalDateTime(feed.lastAccessedAt, locale) }) : str(strings, "feedcal.neverAccessed")}</p>
      <p className="text-sm text-[var(--muted)]">{str(strings, "feedcal.delay")}</p>
      <div>
        <ConfirmButton
          strings={strings}
          label={str(strings, "feedcal.rotate.button")}
          confirmText={str(strings, "feedcal.rotate.confirm")}
          confirmLabel={str(strings, "feedcal.rotate.confirmButton")}
          onConfirm={rotate}
        />
      </div>
    </section>
  );
}

function SettingsForm({
  strings,
  feed,
  platformGroups,
  genreChoices,
  onFeed,
}: {
  strings: AccountStrings;
  feed: CalendarFeedView;
  platformGroups: PlatformGroup[];
  genreChoices: GenreChoice[];
  onFeed: (f: CalendarFeedView) => void;
}): ReactElement {
  const uid = useId();
  const [name, setName] = useState(feed.name);
  const [feedLocale, setFeedLocale] = useState(feed.locale);
  const [includeReleases, setIncludeReleases] = useState(feed.includeReleases);
  const [includeEvents, setIncludeEvents] = useState(feed.includeEvents);
  const [stages, setStages] = useState<Set<string>>(() => new Set(feed.filterStages));
  const [platforms, setPlatforms] = useState<Set<number>>(() => new Set(feed.filterPlatforms));
  const [genres, setGenres] = useState<Set<string>>(() => new Set(feed.filterGenres));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 重新產生網址會換掉 feed 物件，設定沿用，不必重設表單
  function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setNotice(null);
    setFieldErrors({});
    const trimmed = name.trim();
    if (trimmed === "") {
      setFieldErrors({ name: "required" });
      return;
    }
    setSaving(true);
    const res = await patchCalendarFeed(feed.id, {
      name: trimmed,
      locale: feedLocale,
      includeReleases,
      includeEvents,
      filterStages: [...stages],
      filterPlatforms: [...platforms],
      filterGenres: [...genres],
    });
    setSaving(false);
    if (res.ok && res.data) {
      onFeed(res.data.feed);
      setName(res.data.feed.name);
      setFeedLocale(res.data.feed.locale);
      setNotice({ tone: "ok", text: str(strings, res.data.changed ? "feedcal.settings.saved" : "feedcal.settings.unchanged") });
    } else if (res.fields) {
      setFieldErrors(res.fields);
      setNotice({ tone: "error", text: str(strings, "error.summary") });
    } else setNotice({ tone: "error", text: apiErrorText(strings, res) });
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex min-w-0 flex-col gap-4" aria-labelledby={`${uid}-title`} data-section="private-feed-settings">
      <h2 id={`${uid}-title`} className="text-xl font-bold">
        {str(strings, "feedcal.settings.title")}
      </h2>
      <Field id={`${uid}-name`} label={str(strings, "feedcal.settings.name")} error={fieldErrors.name ? fieldErrorText(strings, fieldErrors.name) : null}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className={CONTROL_CLASS} value={name} maxLength={FEED_NAME_MAX} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field id={`${uid}-locale`} label={str(strings, "feedcal.settings.locale")}>
        {({ id }) => (
          <select id={id} className={CONTROL_CLASS} value={feedLocale} onChange={(e) => setFeedLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {str(strings, `feedcal.locale.${l}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeReleases} onChange={(e) => setIncludeReleases(e.target.checked)} />
          <span>{str(strings, "feedcal.settings.includeReleases")}</span>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeEvents} aria-describedby={`${uid}-events-hint`} onChange={(e) => setIncludeEvents(e.target.checked)} />
          <span>{str(strings, "feedcal.settings.includeEvents")}</span>
        </label>
        <p id={`${uid}-events-hint`} className="text-sm text-[var(--muted)]">
          {str(strings, "feedcal.settings.includeEventsHint")}
        </p>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="font-semibold">{str(strings, "feedcal.settings.stages")}</legend>
        <p className="text-sm text-[var(--muted)]">{str(strings, "feedcal.settings.stagesHint")}</p>
        <div className="flex flex-wrap gap-x-4">
          {STAGES.map((s) => (
            <label key={s} className="inline-flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={stages.has(s)} onChange={(e) => setStages((all) => toggle(all, s, e.target.checked))} />
              <span>{str(strings, `feedcal.stage.${s}`)}</span>
            </label>
          ))}
        </div>
        {fieldErrors.filterStages ? <p className="text-sm text-[var(--danger)]">{fieldErrorText(strings, fieldErrors.filterStages)}</p> : null}
      </fieldset>

      <PlatformPicker
        strings={strings}
        groups={platformGroups}
        selected={platforms}
        onChange={setPlatforms}
        max={FEED_FILTER_MAX}
        legend={str(strings, "feedcal.settings.platforms")}
        hint={str(strings, "feedcal.settings.platformsHint")}
        fullText={str(strings, "feedcal.settings.tooManyPlatforms")}
        error={fieldErrors.filterPlatforms ? fieldErrorText(strings, fieldErrors.filterPlatforms) : null}
      />

      {genreChoices.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-1" data-section="private-feed-genres">
          <legend className="font-semibold">{str(strings, "feedcal.settings.genres")}</legend>
          <p className="text-sm text-[var(--muted)]">{str(strings, "feedcal.settings.genresHint")}</p>
          <div className="flex flex-wrap gap-x-4">
            {genreChoices.map((g) => {
              const checked = genres.has(g.slug);
              return (
                <label key={g.slug} className="inline-flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && genres.size >= FEED_FILTER_MAX}
                    onChange={(e) => setGenres((all) => toggle(all, g.slug, e.target.checked))}
                  />
                  <span>{g.label}</span>
                </label>
              );
            })}
          </div>
          {genres.size >= FEED_FILTER_MAX ? <p className="text-sm text-[var(--muted)]">{str(strings, "feedcal.settings.tooManyGenres")}</p> : null}
          {fieldErrors.filterGenres ? <p className="text-sm text-[var(--danger)]">{fieldErrorText(strings, fieldErrors.filterGenres)}</p> : null}
        </fieldset>
      ) : null}

      <div role="status" aria-live="polite" className="min-h-6">
        {notice ? <p className={notice.tone === "error" ? "text-[var(--danger)]" : ""}>{notice.text}</p> : null}
      </div>
      <div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {str(strings, "feedcal.settings.save")}
        </button>
      </div>
    </form>
  );
}
