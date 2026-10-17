"use client";
/**
 * 活動時間顯示（所有顯示活動時間的頁面共用）。
 * 伺服器 HTML 與使用者無關（可快取，不含使用者資訊）：先輸出 UTC；掛載後改寫成使用者的時區，
 * 並在下一行以小字補上 UTC。登入者用帳號時區（users.timezone），訪客與未設定者用瀏覽器時區。
 * 格式化只實作一次：`@sok/i18n` 的 formatEventTimeText。
 */
import { formatEventTimeText, type Locale } from "@sok/i18n";
import { useEffect, useState, type ReactElement } from "react";

const UTC = "UTC";

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC;
  } catch {
    return UTC;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

let zonePromise: Promise<string> | null = null;

/** 這個瀏覽器分頁一次載入內只解析一次：登入者 → 帳號時區；否則瀏覽器時區。任何失敗都退回瀏覽器時區。 */
export function resolveDisplayTimeZone(): Promise<string> {
  zonePromise ??= (async () => {
    const fallback = browserZone();
    try {
      const session = (await fetchJson("/api/v1/auth/get-session")) as { user?: { id?: string } } | null;
      if (!session?.user) return fallback;
      const prefs = (await fetchJson("/api/v1/account/preferences")) as { preferences?: { timezone?: string | null } } | null;
      return prefs?.preferences?.timezone || fallback;
    } catch {
      return fallback;
    }
  })();
  return zonePromise;
}

/** 首次渲染一律 UTC（與伺服器 HTML 相同，避免 hydration 不一致），掛載後換成使用者時區。 */
export function useDisplayTimeZone(): string {
  const [zone, setZone] = useState(UTC);
  useEffect(() => {
    let alive = true;
    void resolveDisplayTimeZone().then((z) => {
      if (alive) setZone(z);
    });
    return () => {
      alive = false;
    };
  }, []);
  return zone;
}

export interface EventTimeProps {
  startIso: string;
  endIso?: string | null;
  locale: Locale;
}

/** 主行：使用者時區；時區不是 UTC 時，下一行小字補 UTC。`<time datetime>` 用 ISO。 */
export function EventTime({ startIso, endIso = null, locale }: EventTimeProps): ReactElement {
  const zone = useDisplayTimeZone();
  const main = formatEventTimeText(startIso, endIso, locale, zone);
  const showUtc = zone !== UTC;
  const utc = showUtc ? formatEventTimeText(startIso, endIso, locale, UTC) : null;
  return (
    <span className="event-time" data-event-time-zone={zone}>
      <span data-event-time="local">
        <time dateTime={startIso}>{main.start}</time>
        {main.end && endIso ? (
          <>
            {" – "}
            <time dateTime={endIso}>{main.end}</time>
          </>
        ) : null}
      </span>
      {utc ? (
        <span className="block text-xs text-[var(--muted)]" data-event-time="utc">
          <time dateTime={startIso}>{utc.start}</time>
          {utc.end && endIso ? (
            <>
              {" – "}
              <time dateTime={endIso}>{utc.end}</time>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
