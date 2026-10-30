"use client";
/**
 * 即時套用的篩選表單（06 §篩選 UI）。
 *
 * - 無 JS：就是 `<form method="get" action>`＋「套用」按鈕，送出後由 proxy 308 到正規網址。
 * - 有 JS：隱藏「套用」按鈕；勾選／選擇／日期變更後短暫等待（合併連續操作），文字／數字欄位 debounce 400ms（失焦或 Enter 立即套用），
 *   然後 `router.replace(新網址, { scroll: false })`。新網址由 live-filter.ts 從「目前網址」算出，位置參數（週、頁碼、分組…）原樣保留。
 *   用 replace：連續調整篩選不會塞滿瀏覽紀錄；上一頁回到進入頁面前的位置。
 * - 連續快速操作：每次事件都重排計時器、觸發時才讀表單目前的值，所以只會導覽一次；Next 對仍在進行中的舊導覽以最後一次為準。
 * - a11y：不移動焦點；導覽開始／完成用 aria-live="polite" 的隱藏文字宣告（不用 role=status：頁面的結果筆數已是 role=status，避免重複的 status 區域）（pending 時表單 aria-busy）。
 * - 上一頁／下一頁（popstate）與 chip／平台種類連結造成的外部變更：伺服器送回新內容後以 key 重新掛載欄位，讓核取方塊與網址一致。
 */
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { holdScroll } from "./hold-scroll";
import { EXTERNAL_FILTER_EVENT, clearFilterHref, liveFilterHref, sameLocation, type LiveEntry } from "./live-filter";

/** 勾選／選擇／日期：合併連續操作的等待時間。 */
export const LIVE_DELAY_MS = 120;
/** 文字／數字欄位 debounce。 */
export const LIVE_TEXT_DELAY_MS = 400;

const NONE: readonly string[] = [];
const noopSubscribe = (): (() => void) => () => undefined;
const TEXT_TYPES = new Set(["text", "search", "number", "email", "url", "tel"]);

export interface LiveControls {
  controlled: string[];
  entries: LiveEntry[];
  /** 有欄位目前的值不合法（例如年份 202 < min）：先不導覽。 */
  valid: boolean;
}

/** 讀表單所有有名稱的欄位（hidden 與按鈕不算：位置參數以網址為準）。 */
export function readLiveControls(form: HTMLFormElement): LiveControls {
  const controlled = new Set<string>();
  const entries: LiveEntry[] = [];
  let valid = true;
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.disabled) continue;
    if (el instanceof HTMLInputElement && (el.type === "hidden" || el.type === "submit" || el.type === "button")) continue;
    controlled.add(el.name);
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.checked) entries.push([el.name, el.value]);
      continue;
    }
    if (el instanceof HTMLInputElement && el.value !== "" && !el.checkValidity()) valid = false;
    if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.selectedOptions)) entries.push([el.name, o.value]);
      continue;
    }
    entries.push([el.name, el.value]);
  }
  return { controlled: [...controlled], entries, valid };
}

export interface LiveFilterFormProps {
  /** 表單路徑（不含 query）。 */
  action: string;
  className?: string;
  applyLabel?: string;
  clearLabel?: string;
  clearHref?: string;
  /** 導覽進行中／完成的朗讀文字（aria-live）。 */
  updatingText: string;
  updatedText: string;
  /** 不渲染「套用」「全部清除」按鈕列（呼叫端自己放按鈕；瀏覽頁的搜尋表單，搜尋按鈕有 JS 時仍保留）。 */
  bare?: boolean;
  /** 這些欄位名稱只在 Enter／送出時套用（搜尋框 q：有候選清單，不邊打邊導覽）。 */
  submitOnlyNames?: readonly string[];
  /** 沒有 JS 時照常送出的隱藏欄位（位置參數；有 JS 時以網址為準）。 */
  hiddenFields?: ReactNode;
  /** 表單內容前（例如 role=search 的標籤等由呼叫端自己決定）。 */
  role?: string;
  ariaLabel?: string;
  children: ReactNode;
}

export function LiveFilterForm({
  action,
  className,
  applyLabel,
  clearLabel,
  clearHref,
  updatingText,
  updatedText,
  bare = false,
  submitOnlyNames = NONE,
  hiddenFields,
  role,
  ariaLabel,
  children,
}: LiveFilterFormProps): ReactElement {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<number | null>(null);
  // 水合後才為 true（伺服器輸出與沒有 JS 時是 false：套用按鈕顯示）
  const live = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [epoch, setEpoch] = useState(0);
  const [external, setExternal] = useState(false);
  const [seen, setSeen] = useState<ReactNode>(children);
  const [navigated, setNavigated] = useState(false);
  const [pending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      if (sameLocation(href, window.location.pathname + window.location.search)) return;
      setExternal(false);
      setNavigated(true);
      holdScroll();
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [router],
  );

  const apply = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const form = formRef.current;
    if (!form) return;
    const c = readLiveControls(form);
    if (!c.valid) return;
    navigate(liveFilterHref({ action, currentSearch: window.location.search, controlled: c.controlled, entries: c.entries }));
  }, [action, navigate]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(apply, delay);
    },
    [apply],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  // 上一頁／下一頁、chip／平台種類連結：欄位狀態會與新網址不一致，等伺服器內容換進來後重新掛載欄位
  useEffect(() => {
    const onExternal = () => setExternal(true);
    window.addEventListener("popstate", onExternal);
    window.addEventListener(EXTERNAL_FILTER_EVENT, onExternal);
    return () => {
      window.removeEventListener("popstate", onExternal);
      window.removeEventListener(EXTERNAL_FILTER_EVENT, onExternal);
    };
  }, []);
  if (seen !== children) {
    // 伺服器送來新內容（props 變動時調整 state 的標準寫法）
    setSeen(children);
    if (external) {
      setExternal(false);
      setEpoch((e) => e + 1);
    }
  }

  // 朗讀：導覽開始「更新中」、完成「已更新」
  const announce = pending ? updatingText : navigated ? updatedText : "";

  // 原生事件而不是 React 的 onChange：核取方塊清單是 dangerouslySetInnerHTML 注入的，React 不會為不屬於它的節點派送合成事件
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onEvent = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return;
      if (t.name && submitOnlyNames.includes(t.name)) return;
      const text = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT_TYPES.has(t.type));
      // input：邊打邊 debounce；change：文字欄位在失焦／Enter 提交時觸發，立即套用
      if (text) {
        if (e.type === "change") apply();
        else schedule(LIVE_TEXT_DELAY_MS);
      } else schedule(LIVE_DELAY_MS);
    };
    form.addEventListener("input", onEvent);
    form.addEventListener("change", onEvent);
    return () => {
      form.removeEventListener("input", onEvent);
      form.removeEventListener("change", onEvent);
    };
  }, [apply, schedule, submitOnlyNames]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    apply();
  };

  const onClear = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const form = formRef.current;
    const controlled = form ? readLiveControls(form).controlled : [];
    // 先把欄位清回預設，再導覽（重新掛載會以伺服器的新內容為準）
    navigate(clearFilterHref({ action, currentSearch: window.location.search, controlled }));
    setExternal(true);
  };

  return (
    <form
      ref={formRef}
      method="get"
      action={action}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      data-live={live ? "on" : undefined}
      data-pending={pending ? "" : undefined}
      onSubmit={onSubmit}
    >
      {hiddenFields}
      <Fragment key={epoch}>{children}</Fragment>
      {bare ? null : (
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary" hidden={live}>
            {applyLabel}
          </button>
          <a className="btn-secondary" href={clearHref ?? action} onClick={onClear} data-filter-clear="">
            {clearLabel}
          </a>
        </div>
      )}
      <p aria-live="polite" className="sr-only" data-live-status="">
        {announce}
      </p>
    </form>
  );
}
