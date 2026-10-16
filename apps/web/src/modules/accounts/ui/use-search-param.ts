import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** 目前網址的 query 參數（客戶端接手後才有值；伺服器端與 hydration 當下為 null，避免 HTML 與網址相關）。 */
export function useSearchParam(name: string): string | null {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return new URLSearchParams(search).get(name);
}
