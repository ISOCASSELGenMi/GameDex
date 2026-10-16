import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * 客戶端接手（hydration）之後才為 true（伺服器端與 hydration 當下為 false）。表單在此之前把送出鈕停用：
 * 否則瀏覽器會把表單原生送出（GET，密碼會出現在網址列與記錄裡）。停用的預設按鈕也會擋掉 Enter 隱式送出。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
