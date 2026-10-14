"use client";
/**
 * [locale]/error.tsx 的內容。錯誤邊界是客戶端元件，拿不到伺服器端字典：
 * 由 [locale] 版面以 ErrorStringsProvider 先放好目前語系的錯誤字串（只有幾個字串，不把整份字典送到客戶端）。
 */
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from "react";

export interface ErrorStrings {
  serverErrorTitle: string;
  serverErrorDescription: string;
  queryTimeoutTitle: string;
  queryTimeout: string;
  tryAgain: string;
  backToCalendar: string;
  clearFilters: string;
  calendarHref: string;
}

/** 與 page-errors.ts 的 QUERY_TIMEOUT_DIGEST 相同（客戶端不 import 伺服器模組）。 */
const QUERY_TIMEOUT_DIGEST = "SOK_QUERY_TIMEOUT";

const ErrorStringsContext = createContext<ErrorStrings | null>(null);

export function ErrorStringsProvider({ value, children }: { value: ErrorStrings; children: ReactNode }): ReactElement {
  return <ErrorStringsContext.Provider value={value}>{children}</ErrorStringsContext.Provider>;
}

export function ErrorView({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactElement {
  const s = useContext(ErrorStringsContext);
  const pathname = usePathname();
  const timeout = error.digest === QUERY_TIMEOUT_DIGEST;
  useEffect(() => {
    if (!timeout) console.error(error);
  }, [error, timeout]);
  if (!s) {
    return (
      <main id="main" className="p-4">
        <h1>Error</h1>
      </main>
    );
  }
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-screen-md flex-1 px-4 py-8 outline-none">
      <h1 className="text-2xl font-bold">{timeout ? s.queryTimeoutTitle : s.serverErrorTitle}</h1>
      <p className="mt-2">{timeout ? s.queryTimeout : s.serverErrorDescription}</p>
      <ul className="mt-4 flex flex-wrap gap-3">
        {timeout && pathname ? (
          <li>
            <a className="btn-primary" href={pathname}>
              {s.clearFilters}
            </a>
          </li>
        ) : (
          <li>
            <button type="button" className="btn-primary" onClick={() => retry()}>
              {s.tryAgain}
            </button>
          </li>
        )}
        <li>
          <a className="btn-secondary" href={s.calendarHref}>
            {s.backToCalendar}
          </a>
        </li>
      </ul>
    </main>
  );
}
