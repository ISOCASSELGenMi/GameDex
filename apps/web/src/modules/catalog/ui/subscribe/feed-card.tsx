"use client";
/**
 * 訂閱頁的 feed 卡片（客戶端元件）：訂閱網址（https）、用行事曆 App 開啟（webcal://）、複製網址。
 * 絕對網址的 origin：伺服器有 NEXT_PUBLIC_SITE_URL 就直接帶進來；沒設時（本機、e2e）掛載後改用 window.location.origin。
 * 平台 feed 多一個平台下拉選單（選了就換網址）。
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";

export interface FeedCardStrings {
  url: string;
  open: string;
  copy: string;
  copied: string;
  copyFailed: string;
}

export interface FeedCardProps {
  /** 例：`releases`、`events`、`platform`（data-feed 屬性，e2e 定位用）。 */
  feedId: string;
  title: string;
  description: string;
  /** 站內路徑（含語系），例：`/ical/en/releases.ics`。 */
  path: string;
  /** NEXT_PUBLIC_SITE_URL 的 origin；null＝掛載後用目前網址。 */
  siteOrigin: string | null;
  strings: FeedCardStrings;
  /** 標題與網址之間的額外內容（平台選單）。 */
  children?: ReactNode;
}

type CopyState = "idle" | "copied" | "failed";

const noopSubscribe = () => () => {};

/** 伺服器渲染與水合時用 siteOrigin（可能是 null）；水合後改用 window.location.origin。 */
function useOrigin(siteOrigin: string | null): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => siteOrigin ?? window.location.origin,
    () => siteOrigin,
  );
}

export function FeedCard({ feedId, title, description, path, siteOrigin, strings, children }: FeedCardProps): ReactElement {
  const origin = useOrigin(siteOrigin);
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const httpsUrl = origin ? `${origin}${path}` : path;
  const webcalUrl = origin ? `webcal://${origin.replace(/^https?:\/\//, "")}${path}` : path;

  async function onCopy(): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(httpsUrl);
      ok = true;
    } catch {
      // 沒有權限或非安全環境：退回選取＋execCommand
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    setCopy(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 4000);
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      id={`feed-${feedId}`}
      data-feed={feedId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm motion-safe:transition-shadow motion-safe:duration-200 hover:shadow-md"
    >
      <h3 id={`${inputId}-title`} className="text-lg font-bold">
        {title}
      </h3>
      <p className="text-sm text-[var(--muted)]">{description}</p>
      {children}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-semibold">
          {strings.url}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          readOnly
          value={httpsUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby={statusId}
          className="min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary motion-safe:transition-transform motion-safe:active:scale-95" href={webcalUrl} data-action="open">
          {strings.open}
        </a>
        <button
          type="button"
          className="btn-secondary motion-safe:transition-transform motion-safe:active:scale-95"
          onClick={() => void onCopy()}
          data-action="copy"
        >
          {strings.copy}
        </button>
      </div>
      <p id={statusId} role="status" className="min-h-5 text-sm" data-copy-status={copy}>
        {copy === "copied" ? strings.copied : copy === "failed" ? strings.copyFailed : ""}
      </p>
    </section>
  );
}

export interface PlatformOption {
  slug: string;
  name: string;
}

export interface PlatformGroupOption {
  label: string;
  platforms: PlatformOption[];
}

export interface PlatformFeedCardProps extends Omit<FeedCardProps, "path" | "children"> {
  /** 路徑樣板，`{slug}` 會被選到的平台取代，例：`/ical/en/platform/{slug}.ics`。 */
  pathTemplate: string;
  groups: PlatformGroupOption[];
  chooseLabel: string;
  /** 預選的平台 slug（例如從平台頁帶來）；不在選單內就用第一個。 */
  initialSlug?: string;
}

export function PlatformFeedCard({ pathTemplate, groups, chooseLabel, initialSlug, ...rest }: PlatformFeedCardProps): ReactElement {
  const selectId = useId();
  const all = groups.flatMap((g) => g.platforms);
  const first = (initialSlug && all.some((p) => p.slug === initialSlug) ? initialSlug : all[0]?.slug) ?? "";
  const [slug, setSlug] = useState(first);
  return (
    <FeedCard {...rest} path={pathTemplate.replace("{slug}", encodeURIComponent(slug))}>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={selectId} className="text-sm font-semibold">
          {chooseLabel}
        </label>
        <select
          id={selectId}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2"
        >
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.platforms.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </FeedCard>
  );
}
